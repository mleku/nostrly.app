---
apply: always
---

Always use named returns when generating code

Always use `if <statement>; chk.E(err) {}` and declare any new variables used
in the statement above the if statement with a var declaration.

When returning from functions, assign the return values in statements above the
return statement. Always make returns "naked" as the code editor shows the
function signature above the current function being edited.

Use short 2-3 letter acronyms for variables that are only used within for,
select and switch blocks, make them relate to the names of the variables that
are referred to such as the subject of the range in a for loop or the channel
name in a select or the condition variable in a switch.

Always start documentation comments with the symbol name verbatim, and then use
this to start a sentence summarizing the symbol's function.

For documentation comments on functions and methods:

- Write a general description in one or two sentences at the top

- use the format `# Header` for headings of sections.

- Follow by a description of the parameters and then return values, with a
  series of bullet points describing each item, each with an empty line in
  between.

- Last, describe the expected behaviour of the function or method, keep this
  with one space apart from the comment start token

For documentation on types, variables and comments, write 1-2 sentences
describing how the item is used.

For documentation on package, summarise in up to 3 sentences the functions and
purpose of the package

Do not use markdown ** or __ or any similar things in initial words of a bullet
point, instead use standard godoc style # prefix for header sections

ALWAYS separate each bullet point with an empty line, and ALWAYS indent them
three spaces after the //

NEVER put a colon after the first word of the first line of a document comment

Use British English spelling and Oxford commas

Always break lines before 80 columns, and flow under bullet points two columns
right of the bullet point hyphen.

Do not write a section for parameters or return values when there is none

In the `# Expected behavior` section always add an empty line after this title
before the description, and don't indent this section as this makes it appear as
preformatted monospace.

A good typical example:

```go
// NewServer initializes and returns a new Server instance based on the provided
// ServerParams and optional settings. It sets up storage, initializes the
// relay, and configures necessary components for server operation.
//
// # Parameters
//
// - sp (*ServerParams): The configuration parameters for initializing the
// server.
//
// - opts (...options.O): Optional settings that modify the server's behavior.
//
// # Return Values
//
// - s (*Server): The newly created Server instance.
//
// - err (error): An error if any step fails during initialization.
//
// # Expected Behaviour
//
// - Initializes storage with the provided database path.
//
// - Configures the server's options using the default settings and applies any
// optional settings provided.
//
// - Sets up a ServeMux for handling HTTP requests.
//
// - Initializes the relay, starting its operation in a separate goroutine.

```

use context7 for information about the nostr protocol in the nostrbook

use additional log statements to help locate the cause of bugs

always use Go v1.25.1 for everything involving Go

always use react for web apps

always use typescript for web apps

always use tanstack/router with web apps

always use react query with web apps

always use bun for running scripts and building things

always use port 4000 for server listener addresses so they don't conflict with the one running on default 3000