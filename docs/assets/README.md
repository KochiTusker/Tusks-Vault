# Documentation images

Images referenced from `docs/**/*.md` live here, and the site generator copies
them to the published site alongside the pages that use them.

This README is skipped by the generator's own skip-list, so it never becomes a
thin page in the index.

**Before adding an image, strip its metadata.** A screenshot carries the
machine it was taken on, and an export from an image editor carries the
software and often the author name in `tEXt` / EXIF chunks. `npm run audit:tree`
inspects binary metadata and will fail on it, so it is easier to check an image
before adding it than to work out afterwards why a check is unhappy.
