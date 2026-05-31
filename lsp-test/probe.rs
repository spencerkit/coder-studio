//! Quick LSP smoke probe for rust-analyzer.
//!
//! Try in the editor once this file is open:
//!
//!   1. Hover over `numbers`, `total`, `multiply_by`, `Greeter`, `greet` —
//!      each should show its inferred Rust type or signature.
//!   2. Ctrl-Click (or F12) on `multiply_by` inside `compute_total` to jump
//!      to its definition.
//!   3. Shift+F12 on `greet` to see references.
//!   4. The line marked `// TYPE ERROR` should get a rust-analyzer
//!      diagnostic (passing a `&str` where `i64` is expected).
//!
//! Note: rust-analyzer is happiest inside a Cargo workspace, so a few
//! features may behave slightly differently here than they would in a
//! real crate, but hover / definition / references still work.

fn multiply_by(value: i64, factor: i64) -> i64 {
    value * factor
}

fn compute_total(numbers: &[i64], factor: i64) -> i64 {
    let mut total = 0;
    for n in numbers {
        total += multiply_by(*n, factor);
    }
    total
}

struct Greeter {
    name: String,
}

impl Greeter {
    fn greet(&self) -> String {
        format!("Hello, {}!", self.name)
    }
}

fn main() {
    println!("{}", compute_total(&[1, 2, 3], 4));
    println!("{}", Greeter { name: "Vue".to_string() }.greet());
    // TYPE ERROR: passing a &str where i64 is expected.
    println!("{}", multiply_by("not a number", 2));
}
