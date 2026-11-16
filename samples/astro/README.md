# Astro での動作確認用のサンプル

[`@astrojs/markdoc`](https://docs.astro.build/ja/guides/integrations-guide/markdoc/) を使う Astro のプロジェクト。
スキーマは Astro の `markdoc.config.mjs` で、`markdoc.config.json` はプラグインが Astro のプロジェクトで作る雛形と同じ
（[ルートの README の「Astro」](../../README.md#astro)）。

```bash
cd samples/astro
npm install          # 言語サーバーが markdoc.config.mjs を読むのに @astrojs/markdoc が要る
npx astro build      # Astro 側で正しく描画できることの確認（dist/ に出力）
cd ../..
./gradlew runIde -Psample=astro
```

## ファイル

| ファイル                              | 内容                                                                                                                    |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `markdoc.config.mjs`                  | `defineMarkdocConfig`・`component()`・`nodes`・`shiki()` を使う Astro のスキーマ                                        |
| `astro.config.mjs`                    | `markdoc({ignoreIndentation: true})`。そのため `markdoc.config.json` に `allowIndentation` がある                       |
| `tsconfig.json`                       | partial に使う別名 `@partials/*`                                                                                        |
| `src/content/blog/why-markdoc.mdoc`   | タグ（`aside`・`image`）、ノードの差し替え（引用）、関数、`$frontmatter`、ページから渡す変数、partial（相対パスと別名） |
| `src/content/blog/guides/nested.mdoc` | サブディレクトリからの partial（`../_footer.mdoc`）                                                                     |
| `src/content/blog/indentation.mdoc`   | 字下げした入れ子のタグ（`ignoreIndentation`）                                                                           |
| `src/content/blog/_footer.mdoc`       | partial。`_` で始まるのでコレクションには入らない                                                                       |
| `src/content/blog/_errors.mdoc`       | 意図的なエラー（存在しない partial、許可されていない属性値、必須属性の欠落）。`_` で始まるので Astro のビルドの対象外   |
| `src/partials/note.mdoc`              | コンテンツの外にある partial。`@partials/note.mdoc` で読む                                                              |
| `src/pages/blog/[...slug].astro`      | `<Content frontmatter={post.data} abTestGroup="…" />` で変数を渡して描画する                                            |

## 確認すること

- `_errors.mdoc` 以外にエラーが出ない（partial の相対パス・別名、`$frontmatter`・`$abTestGroup`、字下げしたタグ）
- partial の `file` で Ctrl+B を押すと partial へ、`{% aside` のタグ名で Ctrl+B を押すと `src/components/Aside.astro`
  へ移動する
- `$frontmatter.author` の `author` で Ctrl+B を押すとフロントマターの `author:` へ、`_footer.mdoc` の `$environment`
  で押すと
  `markdoc.config.mjs` の `environment:` へ移動する（タグの中では太字の切り替えにならない）
- partial の行の Quick Fix「Inline contents of this partial」で、partial の中身に置き換わる
- `{% partial file="./` や `{% partial file="@partials/` の後でパスの補完が出る
- `{% $frontmatter.` の後でフロントマターのキー（`title`・`author`）の補完が出る
