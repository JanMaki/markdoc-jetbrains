import {defineCollection, z} from "astro:content";
import {glob} from "astro/loaders";

// `_` で始まるファイル（partial）はコレクションに含めない
const blog = defineCollection({
    loader: glob({pattern: "**/[^_]*.mdoc", base: "./src/content/blog"}),
    schema: z.object({
        title: z.string(),
        author: z.string().optional(),
    }),
});

export const collections = {blog};
