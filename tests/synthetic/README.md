# Synthetic tests only

Generate fictional inputs from first principles; do not sanitize private files by merely renaming them. Every fixture should explain its generation and expected invariant. Include good controls, valid off-center origins, same reference in different modules, disabled duplicates, malformed data, ambiguous pads, stale sources and idempotent operations. No proprietary customer geometry or private oracle values belong here. Tests are added with the implementation that consumes them; this scaffold does not claim a passing parser suite.
