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
        public readonly additionalChunks: string[] = []
    ) {}
}
