# Lifecycle and errors

Every valid save follows stamp, compile, evaluate, candidate mount, asset resolve, and live execution. A failed candidate is disposed and the last valid canvas remains visible. Obsolete compile work is cancelled.

Errors should identify the source file, line, stable ID when available, and a recovery action. Permanently failed assets retry only after source or asset state changes. All subscriptions, ticker callbacks, media handles, and GPU resources must be disposed on remount.
