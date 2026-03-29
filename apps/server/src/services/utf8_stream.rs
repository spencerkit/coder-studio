pub(crate) struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    pub(crate) fn new() -> Self {
        Self {
            pending: Vec::new(),
        }
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) -> String {
        if chunk.is_empty() {
            return String::new();
        }

        self.pending.extend_from_slice(chunk);
        let mut output = String::new();

        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(valid) => {
                    output.push_str(valid);
                    self.pending.clear();
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        let valid =
                            std::str::from_utf8(&self.pending[..valid_up_to]).unwrap_or_default();
                        output.push_str(valid);
                        self.pending.drain(..valid_up_to);
                    }

                    match error.error_len() {
                        Some(len) => {
                            output.push('\u{FFFD}');
                            self.pending.drain(..len);
                        }
                        None => break,
                    }
                }
            }
        }

        output
    }

    pub(crate) fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let flushed = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        flushed
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8StreamDecoder;

    #[test]
    fn decodes_multibyte_characters_split_across_chunks() {
        let mut decoder = Utf8StreamDecoder::new();

        let first = decoder.push(&[0xE4, 0xBD]);
        let second = decoder.push(&[0xA0, 0xE5, 0xA5, 0xBD]);
        let flushed = decoder.finish();

        assert_eq!(first, "");
        assert_eq!(second, "你好");
        assert_eq!(flushed, "");
    }

    #[test]
    fn preserves_invalid_bytes_with_replacement_and_continues() {
        let mut decoder = Utf8StreamDecoder::new();

        let output = decoder.push(&[0x66, 0x80, 0x6F, 0x6F]);

        assert_eq!(output, "f\u{FFFD}oo");
    }
}
