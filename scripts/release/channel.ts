// Single source of truth for the release channel. Extension registries reject semantic-versioning
// pre-release tags, so the minor number carries the channel: odd minor = pre-release (beta line),
// even minor = stable. See docs/release-process.md "Versioning".
//
// Only plain `major.minor.patch` is accepted. A rejected value is never echoed; the only failure
// is the fixed code VERSION_INVALID.
export type ReleaseChannel = 'pre-release' | 'stable';

const PLAIN_VERSION = /^(?:0|[1-9]\d*)\.(0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

/** The one accepted version shape; every release script uses this, so none can disagree about what a version is. */
export const isPlainVersion = (value: unknown): value is string => typeof value === 'string' && PLAIN_VERSION.test(value);

export function releaseChannel(version: unknown): ReleaseChannel {
 const match = typeof version === 'string' ? PLAIN_VERSION.exec(version) : null;
 if (!match) throw new Error('VERSION_INVALID');
 // Parity of the last digit equals parity of the whole number, however long the minor is.
 return Number(match[1].at(-1)) % 2 === 1 ? 'pre-release' : 'stable';
}

export function isPreReleaseVersion(version: unknown): boolean {
 return releaseChannel(version) === 'pre-release';
}
