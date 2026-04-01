#[derive(Default)]
enum ParseState {
    #[default]
    Text,
    Escape,
    Csi(String),
    Osc,
    OscEscape,
}

#[derive(Default)]
pub(crate) struct AnsiTranscriptSanitizer {
    state: ParseState,
}

impl AnsiTranscriptSanitizer {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push(&mut self, chunk: &str) -> String {
        if chunk.is_empty() {
            return String::new();
        }

        let mut output = String::new();
        for ch in chunk.chars() {
            self.push_char(ch, &mut output);
        }
        output
    }

    pub(crate) fn finish(&mut self) -> String {
        self.state = ParseState::Text;
        String::new()
    }

    fn push_char(&mut self, ch: char, output: &mut String) {
        match &mut self.state {
            ParseState::Text => {
                if ch == '\u{1b}' {
                    self.state = ParseState::Escape;
                    return;
                }

                match ch {
                    '\n' | '\t' => output.push(ch),
                    '\r' => {}
                    '\u{0000}'..='\u{0008}'
                    | '\u{000b}'
                    | '\u{000c}'
                    | '\u{000e}'..='\u{001f}'
                    | '\u{007f}' => {}
                    _ => output.push(ch),
                }
            }
            ParseState::Escape => match ch {
                '[' => self.state = ParseState::Csi(String::new()),
                ']' => self.state = ParseState::Osc,
                '\u{1b}' => self.state = ParseState::Escape,
                _ => self.state = ParseState::Text,
            },
            ParseState::Csi(params) => {
                if ch == '\u{1b}' {
                    self.state = ParseState::Escape;
                    return;
                }
                if ch.is_ascii_control() {
                    self.state = ParseState::Text;
                    return;
                }
                if ('@'..='~').contains(&ch) {
                    if ch == 'm' {
                        output.push('\u{1b}');
                        output.push('[');
                        output.push_str(params);
                        output.push(ch);
                    }
                    self.state = ParseState::Text;
                    return;
                }

                params.push(ch);
            }
            ParseState::Osc => match ch {
                '\u{0007}' => self.state = ParseState::Text,
                '\u{1b}' => self.state = ParseState::OscEscape,
                _ => {}
            },
            ParseState::OscEscape => match ch {
                '\\' | '\u{0007}' => self.state = ParseState::Text,
                '\u{1b}' => self.state = ParseState::OscEscape,
                _ => self.state = ParseState::Osc,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AnsiTranscriptSanitizer;

    #[test]
    fn strips_cursor_control_sequences_across_chunks() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(sanitizer.push("hello\n\u{1b}[1A\u{1b}[2"), "hello\n");
        assert_eq!(sanitizer.push("K\rworking"), "working");
        assert_eq!(sanitizer.finish(), "");
    }

    #[test]
    fn preserves_sgr_sequences_split_across_chunks() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(sanitizer.push("\u{1b}[31"), "");
        assert_eq!(sanitizer.push("mred\u{1b}[0m"), "\u{1b}[31mred\u{1b}[0m");
    }

    #[test]
    fn drops_osc_sequences_without_leaking_title_bytes() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(sanitizer.push("\u{1b}]0;agent title"), "");
        assert_eq!(sanitizer.push("\u{0007}hello"), "hello");
    }
}
