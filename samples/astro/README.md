# Astro での動作確認用のサンプル

[`@astrojs/markdoc`](https://docs.astro.build/ja/guides/integrations-guide/markdoc/) を使う Astro のプロジェクト。
スキーマは Astro の `markdoc.config.mjs` で、`markdoc.config.json` は Astro のドキュメントにある例のとおり
それを `esm` として読む。

```bash
cd samples/astro
npm install          # 言語サーバーが markdoc.config.mjs を読むのに @astrojs/markdoc が要る
npx astro build      # Astro 側で正しく描画できることの確認（dist/ に出力）
cd ../..
./gradlew runIde -Psample=astro
```

## ファイル

| ファイル                                  | 内容                                                                                                   |
|-------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `markdoc.config.mjs`                      | `defineMarkdocConfig`・`component()`・`nodes`・`shiki()` を使う Astro のスキーマ                          |
| `src/content/blog/why-markdoc.mdoc`       | タグ（`aside`・`image`）、ノードの差し替え（引用）、関数、`$frontmatter`、ページから渡す変数、partial   |
| `src/content/blog/guides/nested.mdoc`     | サブディレクトリからの partial（`../_footer.mdoc`）                                                    |
| `src/content/blog/_footer.mdoc`           | partial。`_` で始まるのでコレクションには入らない                                                      |
| `src/pages/blog/[...slug].astro`          | `<Content frontmatter={post.data} abTestGroup="…" />` で変数を渡して描画する                           |

## 今のプラグインで起きると見込まれること

Astro ではビルドが通る正しい文書だが、次の箇所はプラグインが誤って扱うと見込まれる（対応予定）。

- partial：Astro は `file` を書いたファイルからの相対パスで解決するが、プラグインは `markdoc.config.json` の `path`
  （`src/content`）を基準にするため、`./_footer.mdoc` と `../_footer.mdoc` が「存在しない partial」になり、ジャンプもできない
- 変数：スキーマに `variables` があるので、ページから渡す `$frontmatter`・`$abTestGroup` が「Undefined variable」になる
