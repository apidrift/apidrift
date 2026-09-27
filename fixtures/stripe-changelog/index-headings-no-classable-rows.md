<!-- Fixture for US-16, AC2b — THE INDEX-LINE SENTINEL. A SYNTHETIC document
standing in for a vendor reformat one step past index-no-release-headings.md:
the `## <date>[.<channel>]` headings are still there and still parse (so this
is NOT the `index-empty` / zero-heading case), but not one row anywhere in the
whole document is a title link paired with a recognized "Breaking" /
"Non-breaking" cell. Before US-16, `parseChangelogIndex` would `continue`
past every row here in silence and `selectReleases` would answer `'behind'`
with `walked: []` and zero changes — the exact false "nothing to do" AC2b
exists to close. -->

# Stripe API changelog

## 2026-08-26.dahlia

This release reorganized the index into prose only. See the release notes
page for the list of changes; there is no table here to parse.

## 2026-04-22.preview

| Title | Category |
| --- | --- |
| [A row with the wrong number of columns for this parser](https://docs.stripe.com/changelog/preview/2026-04-22/short-row.md) | api |
