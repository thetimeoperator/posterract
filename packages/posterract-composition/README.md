# @posterract/composition

The editor supplies the runtime when a project is mounted, so this package is
needed for **types and tooling** — IntelliSense and `tsc --noEmit`. It carries
no renderer: `useTicker` is a declaration that throws outside a mount, and
elements only become a composition once the editor renders them. The pure
helpers (`parseTime` and the source-stamp constants) are real here;
everything else is a type.

See the versioned Posterract reference under `docs/` and the copy staged into
each project at `.posterract/docs/` for the authoring surface.


## License

[MPL-2.0](./LICENSE)
