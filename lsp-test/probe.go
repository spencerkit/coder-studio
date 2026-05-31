// Quick LSP smoke probe for gopls.
//
// Try in the editor once this file is open:
//
//  1. Hover over `numbers`, `total`, `MultiplyBy`, `Greeter`, `Greet` —
//     each should show its inferred Go signature with package context.
//  2. Ctrl-Click (or F12) on `MultiplyBy` inside `ComputeTotal` to jump
//     to its definition.
//  3. Shift+F12 on `Greet` to see references.
//  4. The line marked `// TYPE ERROR` should get a gopls diagnostic
//     (passing a string where an int is expected).
//
// Note: gopls expects a real module to fully analyze; we declare a
// throwaway one here so the file is self-contained.

package main

import "fmt"

func MultiplyBy(value, factor int) int {
	return value * factor
}

func ComputeTotal(numbers []int, factor int) int {
	total := 0
	for _, n := range numbers {
		total += MultiplyBy(n, factor)
	}
	return total
}

type Greeter struct {
	Name string
}

func (g Greeter) Greet() string {
	return fmt.Sprintf("Hello, %s!", g.Name)
}

func main() {
	fmt.Println(ComputeTotal([]int{1, 2, 3}, 4))
	fmt.Println(Greeter{Name: "Vue"}.Greet())
	// TYPE ERROR: passing a string where an int is expected.
	fmt.Println(MultiplyBy("not a number", 2))
}
