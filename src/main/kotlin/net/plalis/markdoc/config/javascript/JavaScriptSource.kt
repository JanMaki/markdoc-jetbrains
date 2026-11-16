package net.plalis.markdoc.config.javascript

/**
 * JavaScript の設定ファイル（`astro.config.mjs` など）のテキストを、実行せずに読む。
 *
 * コメントと文字列の中身を空白に置き換えた（位置は元のテキストと同じ）テキストで関数の呼び出しを探し、
 * import の名前、呼び出しの引数のテキスト、引数の値を取り出す。
 *
 * @param text 設定ファイルのテキスト
 */
class JavaScriptSource(text: String) {
    /** コメントを空白に置き換えたテキスト。文字列はそのまま残す。 */
    private val withStrings: String

    /**
     * コメントと文字列の中身を空白に置き換えたテキスト。
     * プロパティのキーの文字列（直後に `:` が続く）は、引用符だけを空白にして中身を残す。
     */
    private val code: String

    init {
        val masked = mask(text)
        withStrings = masked.first
        code = masked.second
    }

    /**
     * [module] の既定の import（`import name from "module"`、`import name, { … } from "module"`）の名前。
     *
     * @param module import 元のモジュール名
     * @return import の名前。なければ `null`
     */
    fun defaultImportName(module: String): String? {
        val pattern = Regex(
            """\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']${Regex.escape(module)}["']""",
        )
        return pattern.find(withStrings)?.groupValues?.get(1)
    }

    /**
     * 関数 [function] の呼び出しごとの、括弧の中のテキスト。
     * コメントと文字列の中身は空白で、プロパティのキーの文字列は引用符を外した形になっている。
     *
     * @param function 呼び出す関数の名前
     * @return 呼び出しごとの括弧の中のテキスト（書いた順）
     */
    fun callArgumentCode(function: String): List<String> =
        callRanges(function).map { code.substring(it.first, it.last + 1) }

    /**
     * 関数 [function] の呼び出しごとの、最初の引数の値。
     *
     * @param function 呼び出す関数の名前
     * @return 呼び出しごとの最初の引数（書いた順）。引数のない呼び出しは `null`
     */
    fun firstArguments(function: String): List<JsValue?> =
        callRanges(function).map { JsValueParser(withStrings, it.first, it.last + 1).firstArgument() }

    /**
     * 関数 [function] の呼び出しごとの、括弧の中の範囲（`(` の次から `)` の手前まで）。
     * 閉じていない呼び出しはテキストの末尾までを範囲にする。
     */
    private fun callRanges(function: String): List<IntRange> {
        val call = Regex("""(?<![\w$.])${Regex.escape(function)}\s*\(""")
        return call.findAll(code).map { match ->
            val open = match.range.last
            open + 1 until closingParen(open)
        }.toList()
    }

    /** [open] の `(` に対応する `)` の位置。閉じていなければ末尾。 */
    private fun closingParen(open: Int): Int {
        var depth = 0
        for (i in open until code.length) {
            when (code[i]) {
                '(', '[', '{' -> depth++
                ')', ']', '}' -> if (--depth == 0) return i
            }
        }
        return code.length
    }

    private companion object {
        /**
         * [text] のコメントを空白にしたテキストと、さらに文字列の中身も空白にしたテキストを返す。
         * どちらも [text] と同じ長さで、改行はそのまま残す。
         */
        fun mask(text: String): Pair<String, String> {
            val withStrings = StringBuilder(text)
            val code = StringBuilder(text)
            var i = 0
            while (i < text.length) {
                val c = text[i]
                when {
                    c == '/' && text.getOrNull(i + 1) == '/' -> {
                        val end = text.indexOf('\n', i).let { if (it < 0) text.length else it }
                        blank(withStrings, i, end)
                        blank(code, i, end)
                        i = end
                    }

                    c == '/' && text.getOrNull(i + 1) == '*' -> {
                        val close = text.indexOf("*/", i + 2)
                        val end = if (close < 0) text.length else close + 2
                        blank(withStrings, i, end)
                        blank(code, i, end)
                        i = end
                    }

                    c == '"' || c == '\'' || c == '`' -> {
                        var j = i + 1
                        while (j < text.length && text[j] != c) j += if (text[j] == '\\') 2 else 1
                        val end = minOf(j + 1, text.length)
                        var next = end
                        while (next < text.length && text[next].isWhitespace()) next++
                        if (c != '`' && text.getOrNull(next) == ':') {
                            // プロパティのキーは中身を残し、引用符だけを空白にする
                            code.setCharAt(i, ' ')
                            if (j < text.length) code.setCharAt(j, ' ')
                        } else {
                            // 引用符は残し、中身を空白にする
                            blank(code, i + 1, minOf(j, text.length))
                        }
                        i = end
                    }

                    else -> i++
                }
            }
            return withStrings.toString() to code.toString()
        }

        /** [builder] の [start] から [end] の手前までを、改行を残して空白にする。 */
        fun blank(builder: StringBuilder, start: Int, end: Int) {
            for (k in start until end) if (builder[k] != '\n' && builder[k] != '\r') builder.setCharAt(k, ' ')
        }
    }
}
