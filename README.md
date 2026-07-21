# clean-docs - modular LLM-based documentation generator
 
---
 
## What is this for?

Clean code is great. Clean code that's well documented is even better. This custom GitHub action ingests any new code with a large enough diff to the previous commit hash and generates up-to-date documentation. Through an API call to Anthropic, documentation is auto-generated and indexed for later reference. It is designed to be modular and easily usable in other repositories.
 
## Bits and Pieces
  
- **`docs/`** — Where docs are published and updated.
- **`prompts/`** — A helper directory for Claude to generate documentation with custom behavior
| File | Purpose |
|---|---|
| audience.md | Fine-tune the level of technical depth for all audience types. |
| detailed.md | Verbosity. Increase/Decrease the level of effort and volume of text generated. |
| formatting.md | Adjust look-and-feel. Encourage certain formatting and discourage text decorators you don't like. |
- **`scripts/`** - Location of script(s) responsible for API calls and actually generating documentation.
- **`src/`** - Source code directory from which docs will be created. Can be a single file or a package - will be documented all the same.

## Future Enhancements
- Auto-publishing to GitHub pages
- Transform into a library that can be imported as a dependency, instead of a GH Action workflow

## Documentation Index
- [test.md](test.md)
