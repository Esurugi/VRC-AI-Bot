`implementation/AGENTS.md` stores implementation-facing repository rules.
The bot-runtime harness is defined by the repository-root `AGENTS.md`.
Source code lives in `implementation/src` and tests live in `implementation/test`.

The boundaries of all modules are defined by Bounded Contexts. This ensures that the domains are completely isolated from one another.
Through Dependency Inversion, all input and output pass through typed interfaces. The domain layer never contains any imports related to infrastructure.
We strictly adhere to a Contract-first approach, where the definitions of type signatures and interfaces precede the creation of any implementation files.

Each file must maintain a consistent Cohesion Gradient. This means there should be "only one axis of change" and "only one reason for existence."
The acyclicity of the module graph is a structural invariant; circular imports are considered boundary violations.
Persistence is the responsibility of the repository layer, orchestration belongs to the service layer, and maintaining invariants (business rules) is the responsibility of the domain layer.

Based on the principle of Colocation, type definitions, interfaces, implementations, and tests coexist within directories of the same boundary.
The scope of public APIs is defined via barrel exports. Any symbols that are not exported are treated as private by convention.

All Discord bot implementations and fixes must be done in accordance with Context 7 or the official documentation.
