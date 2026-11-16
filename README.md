# Markdoc Language Service（JetBrains プラグイン）

公式の [`@markdoc/language-server`](https://github.com/markdoc/language-server) を JetBrains の LSP API で動かし、WebStorm
などで Markdoc の補完・検証を提供する非公式プラグイン。

- 対象 IDE：2026.1.4 以降の、Node.js プラグインと Markdown プラグインを持つ JetBrains IDE（下記の「対応 IDE」を参照）
- 対象ファイル：`.mdoc`、`.markdoc`、`*.markdoc.md`（Markdown ファイルとして扱う）
- 実行時に必要なもの：Node.js（プロジェクトの Node.js インタープリター設定を使う）

## 対応 IDE

Node.js プラグインと Markdown プラグインの両方が使える IDE に対応する（Marketplace の互換性表示による）。

- 対応：WebStorm、IntelliJ IDEA（Ultimate・統合版）、PyCharm Professional、PhpStorm、GoLand、RubyMine、Rider、CLion
- 非対応：
    - Android Studio、IntelliJ IDEA Community、PyCharm Community、DataSpell（Node.js プラグインがない）
    - RustRover（Markdown プラグインがない）

## 機能

### 言語サーバー由来

| 機能               | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 検証               | スキーマに基づく検証と構文エラーを波線で表示する（未定義のタグ、許可されていない属性値、必須属性の欠落、存在しない partial など）                                                                                                                                                                                                                                                                                                    |
| タグ名の補完       | `{%`、`{% `、`{% /` の直後から候補を出す。選ぶと閉じタグや必須属性まで入る                                                                                                                                                                                                                                                                                                                                                           |
| 属性名の補完       | `{% callout ` のようにタグ名の後で候補を出す。入力済みの属性は除き、必須の属性を先に並べる                                                                                                                                                                                                                                                                                                                                           |
| 注釈の補完         | `# 見出し {% ` のようにノードの後ろの `{%` で、そのノード（見出し・リスト項目・段落・表のセル）の属性と `class`・`id` を出す。タグ名は出さない（段落だけ、インラインのタグもあり得るので出す）。表のセルは `align`・`colspan`・`rowspan`、見出しセルは `width` も                                                                                                                                                                    |
| 属性値の補完       | `type=` や `type="` の直後から、スキーマの `matches` と Boolean の値を出す。属性名を選んだ直後にも自動で出る                                                                                                                                                                                                                                                                                                                         |
| リンクの補完       | `[text](/` の後で、フロントマターのルートを出す                                                                                                                                                                                                                                                                                                                                                                                      |
| 定義ジャンプ・参照 | `{% partial file="…" /%}` から partial のファイルへ移動し、partial の使用箇所を探す。タグ名の上では、タグを描画するコンポーネント（Astro の `component()` で指定した `.astro` ファイル）へ移動する。変数の上では、フロントマターの変数（`$markdoc.frontmatter.title`、`frontmatterVariable` の `$frontmatter.title`）ならフロントマターのそのトップレベルのキーへ、スキーマの `variables` ならスキーマのファイルのそのキーへ移動する |
| その他             | フォーマット、コード折りたたみ、ドキュメントリンク、Quick Fix                                                                                                                                                                                                                                                                                                                                                                        |

### プラグイン独自

| 機能                 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
|----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ファイルの関連付け   | Markdoc の拡張子を標準の Markdown ファイルタイプに関連付ける                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 設定の受け渡し       | プロジェクトルートの `markdoc.config.json` を読み、先頭のエントリを初期化オプションでサーバーに渡す。ファイルがなければ `path` を `""`（ルート直下）にしたスキーマなしの設定で起動し（Astro のプロジェクトでは [Astro 向けの設定](#astro)）、壊れていれば起動しない                                                                                                                                                                                                                                                                                |
| 設定画面             | Settings → Languages & Frameworks → Markdoc で、言語サーバーの JS ファイル（プルダウンで同梱版か、Select... で選んだファイル）と、設定ファイルのパス（既定 `markdoc.config.json`）を変えられる。設定ファイルの中身は同じ画面の JSON エディタで編集でき、Apply で書き戻す（JSON として読めなければ保存できない）。ファイルがなければ作成時の雛形を読み取り専用で表示し、Create Config File ボタンで雛形の中身のファイルを作ると編集できる。プロジェクトごとに `.idea/markdoc.xml` へ保存する。反映には IDE の再起動が必要                           |
| 設定ファイルの作成   | 設定ファイルがないとき、Markdoc ファイル（`.mdoc` など）を開くか、`.md` ファイルに Markdoc のタグ（`{% … %}`）が現れると、作成を勧める通知を出す（プロジェクトごとに 1 度だけ）。New メニューの「Markdoc Config File」でも作れる（設定のパスに作るので、選んでいるディレクトリには関係しない。ファイルがあれば項目を出さない）。作るファイルの中身は公式の言語サーバーの README（Configuration quickstart）の例と同じなので、`path` やスキーマのパスはプロジェクトに合わせて書き換える。Astro のプロジェクトでは [Astro 向けの設定](#astro) で作る |
| 起動条件             | 信頼済みのプロジェクトで、ローカルの Node.js が設定されているときだけ起動する（サーバーはスキーマの JS を実行するため）                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ファイルパスへの移動 | `partial` の `file`、ほかのタグの `file`・`src`・`href`・`path` の値で Ctrl+B（Ctrl+クリック）するとファイルへ移動する。`partials/footer.mdoc` の `partials` の上ならディレクトリへ移動する。partial の `file` の基準は設定の `partialPaths` に従う。タグ（`{% … %}`）の中と移動できるパスの上でだけ、Ctrl+B を Markdown の太字の切り替えより優先する                                                                                                                                                                                              |
| ファイルパスの補完   | 同じ属性の値で、ディレクトリの中身を候補に出す。`/` を入力すると次の階層の候補が出る。`partial` では Markdoc ファイルだけを出す                                                                                                                                                                                                                                                                                                                                                                                                                    |
| タグの色分け         | `{% … %}` の区切り、タグ名、属性名、文字列、数値、`true`/`false`/`null`、変数、関数に色を付ける。色は Settings → Editor → Color Scheme → Markdoc で変更できる。コメントを有効にしていれば、コメントの中のタグには色を付けず、コメント全体をコメントの色にする                                                                                                                                                                                                                                                                                      |
| `/%}` の自動入力     | タグ名の後で `/` を打つと `/%}` まで入れる。閉じタグの書き始め、引用符の中、後ろに `%}` がある場合は補わない                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Astro

[`@astrojs/markdoc`](https://docs.astro.build/ja/guides/integrations-guide/markdoc/) を使う Astro のプロジェクトにも対応する。
Astro の Markdoc は、partial のパスの書き方や変数の渡し方が上流の言語サーバーの前提と違うため、`markdoc.config.json` に
このプラグイン独自のキーを書いて合わせる。プロジェクトルートに `astro.config.*` があるか、`package.json` の依存に
`@astrojs/markdoc` があれば Astro のプロジェクトとみなし、設定ファイルの作成（通知、New メニュー、設定画面）で次の内容を作る。

```json
[
  {
    "id": "astro",
    "path": "src/content",
    "schema": {
      "path": "markdoc.config.mjs",
      "type": "esm",
      "property": "default",
      "watch": true
    },
    "markdoc": {
      "allowComments": true
    },
    "partialPaths": "relative",
    "frontmatterVariable": "frontmatter",
    "ignoreUndefinedVariables": true
  }
]
```

| キー                                 | 内容                                                                                                                                                                                                                                                                                                     |
|--------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `schema`                             | Astro の `markdoc.config.mjs`（`.ts`・`.js` があればそれ）をそのまま読む。`defineMarkdocConfig`・`component()`・`nodes` を使えるが、`@astrojs/markdoc` を読み込むので、先にプロジェクトで `npm install` しておく                                                                                         |
| `markdoc.allowComments`              | Astro は常に `<!-- … -->` をコメントとして扱う                                                                                                                                                                                                                                                           |
| `markdoc.allowIndentation`           | `astro.config.*` の `markdoc()` で `ignoreIndentation: true` か `allowHTML: true` を書いていれば加える。Astro と同じく、4 文字以上の字下げをコードブロックにしない（加えないと、字下げした入れ子のタグが閉じていないと報告される）                                                                       |
| `partialPaths: "relative"`           | `{% partial file="…" /%}` を Astro と同じく解決する。`./`・`../` と、`/` も `.` もない名前は書いたファイルから、`/` はプロジェクトルートから、`tsconfig.json` の `compilerOptions.paths` の別名（`@partials/…`）はその行き先から。検証、定義ジャンプ・参照、Ctrl+B、パスの補完、Quick Fix のすべてに効く |
| `frontmatterVariable: "frontmatter"` | ページから `<Content frontmatter={entry.data} />` で渡す `$frontmatter` を、文書のフロントマターとして補完・検証する                                                                                                                                                                                     |
| `ignoreUndefinedVariables: true`     | 「Undefined variable」を報告しない。ほかの変数もページから `<Content />` に渡せて、エディタからは分からないため（Astro もビルド時にこのエラーを無視する）                                                                                                                                                |

Astro のプロジェクトで設定ファイルがなくても、プロジェクトルートに `markdoc.config.*` があれば、上と同じ設定で言語サーバーを起動する。

そのほか、Astro に関係する動作は次のとおり。

- タグ名の上で Ctrl+B（Ctrl+クリック）すると、`render: component("./src/components/Aside.astro")` のコンポーネントへ移動する
  （パスはプロジェクトルートから解決する。`component("@astrojs/starlight/components", "Tabs")` のようなパッケージは対象外）
- `markdoc.config.ts` も読める。Node.js 22.18・23.6 以降は型の除去が既定で有効で、22.6 以降はプラグインが
  `--experimental-strip-types` を付けて起動する。それより前の Node.js では読めない理由を通知する
- `allowHTML` で HTML を混ぜた文書は、言語サーバーには HTML を通常のテキストとして見せる（`html` は渡さない）。
  `typographer` はエディタの動作に関係しない

確認用のプロジェクトは `samples/astro/`（[README](samples/astro/README.md)）。

### 独自のキー

`partialPaths`・`frontmatterVariable`・`ignoreUndefinedVariables` は Astro 以外でも使える。上流の言語サーバー（VS Code
の拡張機能）は
これらを読まないので、同じ設定ファイルを VS Code でも使う場合は、そちらでは効かない。

| キー                       | 値                                                                 | 既定        |
|----------------------------|--------------------------------------------------------------------|-------------|
| `partialPaths`             | `"content"`（`path` から）・`"relative"`（上記）                   | `"content"` |
| `frontmatterVariable`      | フロントマターを入れる変数の名前（`$` は付けても付けなくてもよい） | なし        |
| `ignoreUndefinedVariables` | 真なら「Undefined variable」を報告しない                           | `false`     |

## コメント

Markdoc は既定ではコメントを扱わず、`<!-- … -->` はただのテキストになる。中にタグがあれば処理され、検証の対象にもなる。
`markdoc.config.json` のエントリに `markdoc` を書くと、サーバーはそれを Markdoc のトークナイザーに渡す。
`allowComments` を有効にすると `<!-- … -->` がコメントになる。

```json
[
  {
    "id": "my-site",
    "path": "docs",
    "schema": {
      "path": "schema.js",
      "type": "node"
    },
    "markdoc": {
      "allowComments": true
    }
  }
]
```

有効にすると、コメントの中のタグは検証されず、色も付かない（複数行のコメントも含め、コメント全体をコメントの色にする）。ビルド側の
`Markdoc.Tokenizer` にも同じ設定を渡すこと
（`new Markdoc.Tokenizer({ allowComments: true })`）。色分けは設定ファイルを保存すると切り替わるが、検証に反映するには
IDE の再起動が必要。

コメントの扱いは Markdoc の実装に従う。

- 行（字下げとリストの印の後）が `<!--` で始まると、空行をまたいで最初の `-->` までがコメントになる。`-->` と同じ行の残りは
  捨てられる（タグを書いても処理されない）
- 行の途中の `<!--` は、同じ段落の中の最初の `-->` までがコメントになる
- 閉じていない `<!--` はコメントにならない
- フェンスコードブロックとインラインコードの中、`\<!--` はコメントにならない
- リスト項目・引用の中に行頭から書いたコメントと、強調（`*…*`）・リンクのテキストの中のコメントは、Markdoc の検証で
  「Can't nest 'comment' in …」のエラーになる

### 同梱する Markdoc の不具合の回避（暫定）

同梱する言語サーバーが使う Markdoc（`@markdoc/language-server` 0.0.14 が依存する 0.3 系）のコメントの規則には不具合があり、
次の場合にサーバーが応答しなくなり、メモリを使い切って終了する。

- 行の途中の `<!--` が、同じ段落の中で閉じていない（入力中によく起こる）
- リンクのテキスト（`[<!-- … -->](…)`）の中にコメントがある（最新の Markdoc 0.5.11 でも直っておらず、例外になる）

暫定の対処として、`language-server/src/comments.js` でコメントの規則を直したものに差し替えている。閉じていない `<!--` は、
最新の Markdoc（0.5 系）と同じくコメントにしない（0.3 系は行頭の `<!--` なら文書の末尾までをコメントにする）。
上流が直った Markdoc に更新したら、この差し替えは消す（コード中に TODO を残してある）。

## 上流の言語サーバーとの違い

同梱する言語サーバーは、上流の `server()` に次の差し替えを加えて起動する（`language-server/src/`）。

| ファイル          | 差し替える理由                                                                                                                                                                                                                                                            |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `capabilities.js` | 上流は補完などの機能を初期化後に動的に登録するが、JetBrains の LSP クライアントは動的登録を使わない。同じ機能を初期化時に宣言する                                                                                                                                         |
| `completion.js`   | 上流の補完は出る場面が少なく、挿入テキストを resolve で補う（JetBrains は resolve の結果から説明文しか使わない）。補完を広げ（変数名・関数名を含む）、挿入テキストを最初から返す                                                                                          |
| `validation.js`   | 上流は partial の存在を起動時のスキャン結果だけで判定し、後から書いた partial を「見つからない」と報告する。編集中の文書とディスク上のファイルで判定する。また、組み込みの `$markdoc.frontmatter.*` を未定義の変数と報告しないようにし、`ignoreUndefinedVariables` に従う |
| `partials.js`     | partial の `file` の解決（`partialPaths`、tsconfig の別名）。上流は常にコンテンツのディレクトリから探す。検証・定義ジャンプ・リンク・Quick Fix で共用する                                                                                                                 |
| `definition.js`   | partial の定義ジャンプと参照を `partials.js` で解決する（上流は `file` の文字列が同じものしか参照として探さない）。タグ名からコンポーネントへ、変数からフロントマターのキーとスキーマの `variables` への定義ジャンプを加える                                              |
| `link.js`         | partial のドキュメントリンクの行き先を `partials.js` で解決する。解決できない partial にはリンクを出さない                                                                                                                                                                |
| `codeaction.js`   | 「Inline contents of this partial」の partial を `partials.js` で解決する（上流は解決できないと ENOENT で失敗し続ける）。どのクライアントも実装していないコマンドを呼ぶ「Extract content to new partial」は出さない                                                       |
| `schema.js`       | 上流は ESM のスキーマを絶対パスのまま import するので Windows で読めず、読み込みの失敗も握りつぶす。`file://` の URL で読み、失敗したら理由を通知する                                                                                                                     |
| `variables.js`    | 補完と検証で共有する、文書から参照できる変数（設定の `variables`、`$markdoc.frontmatter`、`frontmatterVariable`）の組み立て                                                                                                                                               |
| `scanner.js`      | Windows でドライブ文字の大文字・小文字と区切り文字が食い違い、partial が見つからない。パスの表記をそろえる                                                                                                                                                                |
| `comments.js`     | 同梱する Markdoc のコメントの規則の不具合で、サーバーが応答しなくなる。直した規則に差し替える（暫定。[同梱する Markdoc の不具合の回避](#同梱する-markdoc-の不具合の回避暫定)）                                                                                            |

プラグイン側でも、サーバーが定義ジャンプなどの行き先を URI ではなくファイルパスで返す問題に対応している（
`MarkdocLspClientDescriptor.findFileByUri`）。

## 構成

```
src/main/kotlin/net/plalis/markdoc/
  MarkdocFiles.kt                    Markdoc ファイルの判定
  MarkdocConfigReader.kt             markdoc.config.json の読み込みと初期化オプションの組み立て
  MarkdocConfigFile.kt               markdoc.config.json の雛形と作成
  MarkdocTagScanner.kt               タグの中のトークンの切り出し（色分けとパスの特定で共用）
  MarkdocTypedHandler.kt             `/` 入力時の `/%}` の自動入力と、パスの補完の自動表示
  MarkdocActionPromoter.kt           タグの中とパスの上での Ctrl+B を太字の切り替えより優先
  highlighting/                      タグの色分け（注釈、色の定義、色の設定画面）と、タグの中の Markdown の色・警告の除去
  paths/                             属性値のファイルパスの特定、解決、移動、補完
  lsp/MarkdocLspIntegrationProvider.kt  起動条件の判定
  lsp/MarkdocLspClientDescriptor.kt     サーバーの起動、URI の解決、初期化オプション
  lsp/MarkdocCompletionSupport.kt       属性名の挿入後に補完を開き直す
  lsp/MarkdocLspGotoDeclarationHandler.kt  タグの中の Ctrl+B を言語サーバーの定義ジャンプで行う（見出しの中でも効くように）
  lsp/MarkdocServerResolver.kt          サーバーの場所の解決（設定で指定がなければ同梱）
  settings/                             プロジェクト設定の保存と設定画面
  config/                               設定ファイルがないときの通知と、New メニューからの作成、Astro のプロジェクトの判定と雛形
src/main/resources/META-INF/
  plugin.xml                         必須の拡張（ファイルタイプ、入力補助）
  lsp.xml                            LSP API がある IDE でだけ読み込む拡張
language-server/
  src/                               同梱サーバーのエントリーポイントと差し替え
  build.mjs                          esbuild で 1 ファイルにまとめる
samples/basic/                       動作確認用の Markdoc プロジェクト
samples/astro/                       Astro（@astrojs/markdoc）での動作確認用のプロジェクト
```

## 開発

```bash
./gradlew buildPlugin      # build/distributions/ に配布 ZIP を作る
./gradlew verifyPlugin     # Plugin Verifier で対応 IDE の 2026.1.4 との互換性を検査する
./gradlew runIde           # samples/basic を開いたサンドボックスの WebStorm を起動する
./gradlew runIde -PlspTrace  # LSP のメッセージを log_runIde/language-services/ に記録する
./gradlew runIde -Psample=astro  # samples/astro を開く（先に samples/astro で npm install しておく）
```

言語サーバーは `prepareSandbox` の前に `language-server/` で `npm ci` と esbuild が走り、配布ディレクトリの `server/`
に置かれる。

## 短縮記法（`.class`・`#id`）

`{% .note #top %}` のような短縮記法の補完には対応しない。入力した名前に対して出せる候補（属性名やタグ名のような決まった一覧）がなく、
同じ内容は `class="…"`・`id="…"` の属性として補完されるため。

## 未実装

仕様書の Stage 2 以降の機能（アイコン、Node.js 未検出時の通知、設定ファイルの変更監視、言語サーバーの選択、`.md`
の扱いの切り替えなど）はまだない。設定ファイルや設定画面の内容を変更した場合は IDE の再起動が必要。
