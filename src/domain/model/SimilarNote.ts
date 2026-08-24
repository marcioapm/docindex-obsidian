import type { MediaType } from "@/adapter/docindex";

export class SimilarNote {
    constructor(
        public readonly title: string,
        public readonly path: string,
        public readonly similarity: number,
        public readonly similarChunk: string,
        public readonly sourceChunk: string,
        /**
         * Extra chunk snippets from the same note that also matched the
         * query. Non-empty only when the backend returned multiple hits
         * for a single path — the sidebar groups them under the top hit
         * as expandable sub-rows. Populated by `RemoteSearchService`.
         */
        public readonly additionalChunks: string[] = [],
        /**
         * Heading chain of the top-scoring chunk (root → deepest), e.g.
         * `["Section", "Subsection"]`. The sidebar uses the deepest entry
         * as a link anchor so clicking scrolls the opened note to the
         * relevant heading instead of the top. Empty array = no heading,
         * e.g. plain `.txt` files or notes without ATX headings.
         */
        public readonly headingPath: string[] = [],
        /**
         * Stable identifier of the top-scoring chunk, used as a React
         * key in list views. Ensures row identity tracks the backing
         * chunk rather than the path — two different queries that both
         * surface `foo.md` get different keys and so don't reuse stale
         * DOM state like an expanded preview. Empty string = unknown
         * (legacy or non-remote providers).
         */
        public readonly chunkId: string = "",
        /** Content category of the top-scoring chunk. Defaults to "text". */
        public readonly mediaType: MediaType = "text",
        /**
         * 0-based start page of the embedded range (PDFs). Null when the
         * media is not paginated or when the server didn't supply it.
         */
        public readonly mediaStart: number | null = null,
        /**
         * 0-based exclusive end page of the embedded range (PDFs). Null
         * when the media is not paginated or when the server didn't supply
         * it. Display as 1-based inclusive: [mediaStart+1, mediaEnd].
         */
        public readonly mediaEnd: number | null = null,
        /**
         * True when the embedding covers only part of the source (e.g.
         * first frame of animated GIF, oversized input). Undefined when
         * the server didn't supply it; treat as false.
         */
        public readonly truncated: boolean = false
    ) {}
}
