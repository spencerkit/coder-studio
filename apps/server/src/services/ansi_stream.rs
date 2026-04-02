#[derive(Default)]
enum ParseState {
    #[default]
    Text,
    Escape,
    Csi(String),
    Osc,
    OscEscape,
}

pub(crate) struct AnsiTranscriptSanitizer {
    state: ParseState,
    line_has_output: bool,
    transcript_started: bool,
    block_base_row: usize,
    emitted_row: usize,
    emitted_col: usize,
    cursor_row: usize,
    cursor_col: usize,
    pending_line_reset: bool,
    pending_block_reset: bool,
    skip_line_feed: bool,
}

impl Default for AnsiTranscriptSanitizer {
    fn default() -> Self {
        Self {
            state: ParseState::default(),
            line_has_output: false,
            transcript_started: false,
            block_base_row: 1,
            emitted_row: 1,
            emitted_col: 1,
            cursor_row: 1,
            cursor_col: 1,
            pending_line_reset: false,
            pending_block_reset: false,
            skip_line_feed: false,
        }
    }
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
        self.line_has_output = false;
        self.transcript_started = false;
        self.block_base_row = 1;
        self.emitted_row = 1;
        self.emitted_col = 1;
        self.cursor_row = 1;
        self.cursor_col = 1;
        self.pending_line_reset = false;
        self.pending_block_reset = false;
        self.skip_line_feed = false;
        String::new()
    }

    fn push_char(&mut self, ch: char, output: &mut String) {
        if !matches!(ch, '\n' | '\r' | '\u{1b}') {
            self.skip_line_feed = false;
        }
        match &mut self.state {
            ParseState::Text => {
                if ch == '\u{1b}' {
                    self.state = ParseState::Escape;
                    return;
                }

                match ch {
                    '\n' => {
                        if self.skip_line_feed {
                            self.skip_line_feed = false;
                        } else {
                            self.push_transcript_newline(output);
                            self.cursor_row = self.cursor_row.saturating_add(1);
                            self.cursor_col = 1;
                        }
                        self.pending_line_reset = false;
                    }
                    '\t' => {
                        self.push_visible_char(ch, output);
                    }
                    '\r' => {
                        if self.pending_line_reset {
                            self.cursor_col = 1;
                            self.pending_line_reset = false;
                            self.skip_line_feed = true;
                            return;
                        }
                        if self.line_has_output {
                            self.push_transcript_newline(output);
                            self.cursor_row = self.cursor_row.saturating_add(1);
                        }
                        self.cursor_col = 1;
                        self.pending_block_reset = true;
                        self.skip_line_feed = true;
                    }
                    '\u{0000}'..='\u{0008}'
                    | '\u{000b}'
                    | '\u{000c}'
                    | '\u{000e}'..='\u{001f}'
                    | '\u{007f}' => {}
                    _ => self.push_visible_char(ch, output),
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
                    let params = params.clone();
                    self.handle_csi(&params, ch);
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

    fn push_visible_char(&mut self, ch: char, output: &mut String) {
        self.prepare_for_visible_text(output);
        output.push(ch);
        self.cursor_col = self.cursor_col.saturating_add(1);
        self.emitted_col = self.cursor_col;
        self.line_has_output = true;
        self.pending_line_reset = false;
        self.pending_block_reset = false;
    }

    fn prepare_for_visible_text(&mut self, output: &mut String) {
        if !self.transcript_started || self.pending_block_reset {
            if self.transcript_started && self.line_has_output {
                self.push_transcript_newline(output);
            }
            self.transcript_started = true;
            self.block_base_row = self.cursor_row.max(1);
            self.emitted_row = 1;
            self.emitted_col = 1;
            self.pending_block_reset = false;
        }

        let target_row = self
            .cursor_row
            .saturating_sub(self.block_base_row)
            .saturating_add(1);

        if target_row < self.emitted_row
            || (target_row == self.emitted_row && self.cursor_col < self.emitted_col)
        {
            if self.line_has_output {
                self.push_transcript_newline(output);
            }
            self.block_base_row = self.cursor_row.max(1);
            self.emitted_row = 1;
            self.emitted_col = 1;
        }

        while self.emitted_row < target_row {
            self.push_transcript_newline(output);
        }

        let spaces = self.cursor_col.saturating_sub(self.emitted_col);
        if spaces > 0 {
            output.push_str(&" ".repeat(spaces));
            self.emitted_col = self.emitted_col.saturating_add(spaces);
        }
    }

    fn push_transcript_newline(&mut self, output: &mut String) {
        output.push('\n');
        self.line_has_output = false;
        self.pending_line_reset = false;
        self.emitted_row = self.emitted_row.saturating_add(1);
        self.emitted_col = 1;
    }

    fn handle_csi(&mut self, params: &str, final_char: char) {
        match final_char {
            'm' => {}
            'A' => {
                let count = parse_csi_count(params, 1);
                self.cursor_row = self.cursor_row.saturating_sub(count).max(1);
                self.pending_block_reset = true;
            }
            'B' => {
                let count = parse_csi_count(params, 1);
                self.cursor_row = self.cursor_row.saturating_add(count);
            }
            'C' => {
                let count = parse_csi_count(params, 1);
                self.cursor_col = self.cursor_col.saturating_add(count);
            }
            'D' => {
                let count = parse_csi_count(params, 1);
                self.cursor_col = self.cursor_col.saturating_sub(count).max(1);
                self.pending_block_reset = true;
            }
            'G' => {
                let col = parse_csi_count(params, 1);
                if col < self.cursor_col {
                    self.pending_block_reset = true;
                }
                self.cursor_col = col.max(1);
            }
            'H' | 'f' => {
                let (row, col) = parse_csi_position(params);
                if row < self.cursor_row || (row == self.cursor_row && col < self.cursor_col) {
                    self.pending_block_reset = true;
                }
                self.cursor_row = row.max(1);
                self.cursor_col = col.max(1);
            }
            'J' | 'K' => {
                self.pending_line_reset = true;
                self.pending_block_reset = true;
            }
            _ => {
                self.pending_block_reset = true;
            }
        }
    }
}

fn parse_csi_count(params: &str, default: usize) -> usize {
    params
        .split(';')
        .find_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }
            trimmed.parse::<usize>().ok()
        })
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn parse_csi_position(params: &str) -> (usize, usize) {
    let mut parts = params.split(';');
    let row = parts
        .next()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1);
    let col = parts
        .next()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1);
    (row, col)
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
    fn drops_sgr_sequences_split_across_chunks() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(sanitizer.push("\u{1b}[31"), "");
        assert_eq!(sanitizer.push("mred\u{1b}[0m"), "red");
    }

    #[test]
    fn drops_osc_sequences_without_leaking_title_bytes() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(sanitizer.push("\u{1b}]0;agent title"), "");
        assert_eq!(sanitizer.push("\u{0007}hello"), "hello");
    }

    #[test]
    fn turns_bare_carriage_return_updates_into_separate_lines() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(
            sanitizer.push("working\rworking.\rworking..\n"),
            "working\nworking.\nworking..\n"
        );
    }

    #[test]
    fn preserves_cursor_forward_spacing_for_word_separated_tui_output() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(
            sanitizer.push("\u{1b}[1CAccessing\u{1b}[1Cworkspace:\r\r\n"),
            " Accessing workspace:\n",
        );
        assert_eq!(
            sanitizer
                .push("\u{1b}[1CQuick\u{1b}[1Csafety\u{1b}[1Ccheck:\u{1b}[1CIs\u{1b}[1Cthis\r\r\n"),
            " Quick safety check: Is this\n",
        );
    }

    #[test]
    fn reconstructs_absolute_cursor_layout_into_readable_transcript_lines() {
        let mut sanitizer = AnsiTranscriptSanitizer::new();

        assert_eq!(
            sanitizer.push(
                "\u{1b}[2;1H  \u{2728}\u{1b}[2;5HUpdate available!\u{1b}[2;24H0.117.0 -> 0.118.0\u{1b}[4;3HRelease notes:\u{1b}[6;1H\u{203a} 1. Update now\u{1b}[7;3H2. Skip\u{1b}[10;3HPress enter to continue"
            ),
            "  \u{2728} Update available!  0.117.0 -> 0.118.0\n\n  Release notes:\n\n\u{203a} 1. Update now\n  2. Skip\n\n\n  Press enter to continue",
        );
    }
}
