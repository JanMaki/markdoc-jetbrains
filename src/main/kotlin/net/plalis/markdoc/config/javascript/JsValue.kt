package net.plalis.markdoc.config.javascript

/**
 * JavaScript の設定ファイルに書かれたリテラルの値。
 *
 * [JavaScriptSource.firstArguments] が返す。リテラルとして読めない式（変数、関数の呼び出し、演算など）は [JsOther] になる。
 */
sealed interface JsValue

/**
 * 文字列リテラル（`${}` を含まないテンプレート文字列を含む）。
 *
 * @property value エスケープを戻した中身
 */
data class JsString(val value: String) : JsValue

/**
 * `true` か `false`。
 *
 * @property value 値
 */
data class JsBoolean(val value: Boolean) : JsValue

/**
 * 配列リテラル。
 *
 * @property items 要素（書いた順）。空の要素（`[, a]`）は含めない
 */
data class JsArray(val items: List<JsValue>) : JsValue

/**
 * オブジェクトリテラル。
 *
 * 名前、文字列、数値のキーのプロパティだけを持つ。スプレッド（`...a`）、計算されたキー（`[a]: 1`）、
 * メソッド、ゲッター、省略記法（`{ a }`）のプロパティは含めない。同じキーが複数あれば後のものを使う。
 *
 * @property properties キーと値
 */
data class JsObject(val properties: Map<String, JsValue>) : JsValue {
    /**
     * キー [key] の値。
     *
     * @param key プロパティのキー
     * @return 値。なければ `null`
     */
    operator fun get(key: String): JsValue? = properties[key]
}

/**
 * 正規表現リテラル。
 *
 * @property pattern `/` と `/` の間のテキスト
 * @property flags フラグ（`g`、`i` など）
 */
data class JsRegex(val pattern: String, val flags: String) : JsValue

/**
 * リテラルとして読めない式。
 *
 * @property text 式のテキスト（前後の空白を除く）
 */
data class JsOther(val text: String) : JsValue

/**
 * [text] の [start] から [end] の手前までを、関数の呼び出しの引数として読む。
 *
 * [text] はコメントを空白に置き換えたものとする。読めない式は例外にせず [JsOther] にする。
 *
 * @param text コメントを空白に置き換えたテキスト
 * @param start 読み始める位置（`(` の次）
 * @param end 読み終える位置（`)` の位置）
 */
internal class JsValueParser(private val text: String, start: Int, private val end: Int) {
    /** 次に読む位置。 */
    private var position = start

    /**
     * 最初の引数の値。
     *
     * @return 値。引数がなければ `null`
     */
    fun firstArgument(): JsValue? {
        skipSpace()
        if (position >= end) return null
        return value()
    }

    /** [position] から値を 1 つ読む。値の後ろに演算などが続けば、式全体を [JsOther] にする。 */
    private fun value(): JsValue {
        skipSpace()
        val start = position
        val literal = when (text.getOrNull(position)?.takeIf { position < end }) {
            '{' -> objectLiteral()
            '[' -> arrayLiteral()
            '"', '\'' -> stringLiteral()
            '`' -> templateLiteral()
            '/' -> regexLiteral()
            else -> keyword()
        }
        skipSpace()
        if (literal != null && (position >= end || text[position] in TERMINATORS)) return literal
        position = start
        return other()
    }

    /** `{` から始まるオブジェクトリテラル。閉じていなければ `null`。 */
    private fun objectLiteral(): JsValue? {
        position++
        val properties = LinkedHashMap<String, JsValue>()
        while (true) {
            skipSpace()
            if (position >= end) return null
            when (text[position]) {
                '}' -> {
                    position++
                    return JsObject(properties)
                }

                ',' -> position++
                else -> {
                    val before = position
                    val key = propertyKey()
                    skipSpace()
                    if (key != null && position < end && text[position] == ':') {
                        position++
                        properties[key] = value()
                    } else {
                        // スプレッド、計算されたキー、メソッド、省略記法は、次の区切りまで読み飛ばす
                        skipExpression()
                    }
                    // 閉じ括弧が合わない（`{ ] }`）などで進めなければ、オブジェクトとして読まない
                    if (position == before) return null
                }
            }
        }
    }

    /** `[` から始まる配列リテラル。閉じていなければ `null`。 */
    private fun arrayLiteral(): JsValue? {
        position++
        val items = ArrayList<JsValue>()
        while (true) {
            skipSpace()
            if (position >= end) return null
            when (text[position]) {
                ']' -> {
                    position++
                    return JsArray(items)
                }

                ',' -> position++
                else -> {
                    val before = position
                    items += value()
                    // 閉じ括弧が合わない（`[ } ]`）などで進めなければ、配列として読まない
                    if (position == before) return null
                }
            }
        }
    }

    /** オブジェクトのキー（名前、文字列、数値）。キーとして読めなければ `null`（位置は進めない）。 */
    private fun propertyKey(): String? {
        val c = text[position]
        return when {
            c == '"' || c == '\'' -> (stringLiteral() as? JsString)?.value
            c.isJavaIdentifierStart() -> {
                val start = position
                while (position < end && text[position].isJavaIdentifierPart()) position++
                text.substring(start, position)
            }

            c.isDigit() -> {
                val start = position
                while (position < end && (text[position].isDigit() || text[position] == '.')) position++
                text.substring(start, position)
            }

            else -> null
        }
    }

    /** `"` か `'` から始まる文字列リテラル。閉じていなければ `null`。 */
    private fun stringLiteral(): JsValue? {
        val quote = text[position]
        val builder = StringBuilder()
        var i = position + 1
        while (i < end && text[i] != quote) {
            if (text[i] == '\\') {
                i = escape(i, builder) ?: return null
            } else {
                if (text[i] == '\n') return null
                builder.append(text[i++])
            }
        }
        if (i >= end) return null
        position = i + 1
        return JsString(builder.toString())
    }

    /** `` ` `` から始まるテンプレート文字列。`${` を含めば `null`。 */
    private fun templateLiteral(): JsValue? {
        val builder = StringBuilder()
        var i = position + 1
        while (i < end && text[i] != '`') {
            when {
                text[i] == '\\' -> i = escape(i, builder) ?: return null
                text[i] == '$' && text.getOrNull(i + 1) == '{' -> return null
                else -> builder.append(text[i++])
            }
        }
        if (i >= end) return null
        position = i + 1
        return JsString(builder.toString())
    }

    /**
     * [backslash] の `\` から始まるエスケープを戻して [builder] に加える。
     *
     * @param backslash `\` の位置
     * @param builder 戻した文字を加える先
     * @return エスケープの直後の位置。読めなければ `null`
     */
    private fun escape(backslash: Int, builder: StringBuilder): Int? {
        val next = text.getOrNull(backslash + 1)?.takeIf { backslash + 1 < end } ?: return null
        return when (next) {
            'n' -> builder.append('\n').let { backslash + 2 }
            't' -> builder.append('\t').let { backslash + 2 }
            'r' -> builder.append('\r').let { backslash + 2 }
            'b' -> builder.append('\b').let { backslash + 2 }
            'f' -> builder.append('\u000C').let { backslash + 2 }
            'v' -> builder.append('\u000B').let { backslash + 2 }
            '0' -> builder.append('\u0000').let { backslash + 2 }
            'x' -> hex(backslash + 2, 2, builder)
            'u' -> if (text.getOrNull(backslash + 2) == '{') {
                val close = text.indexOf('}', backslash + 3).takeIf { it in 0 until end } ?: return null
                codePoint(text.substring(backslash + 3, close), builder)?.let { close + 1 }
            } else {
                hex(backslash + 2, 4, builder)
            }

            // 行の継続（`\` と改行）は何も加えない
            '\r' -> if (text.getOrNull(backslash + 2) == '\n') backslash + 3 else backslash + 2
            '\n' -> backslash + 2
            else -> builder.append(next).let { backslash + 2 }
        }
    }

    /**
     * [start] からの [length] 桁の 16 進数の文字を [builder] に加える。
     *
     * @param start 16 進数の先頭の位置
     * @param length 桁数
     * @param builder 文字を加える先
     * @return 16 進数の直後の位置。読めなければ `null`
     */
    private fun hex(start: Int, length: Int, builder: StringBuilder): Int? {
        if (start + length > end) return null
        return codePoint(text.substring(start, start + length), builder)?.let { start + length }
    }

    /**
     * 16 進数の [digits] が表す文字を [builder] に加える。
     *
     * @param digits 16 進数の文字列
     * @param builder 文字を加える先
     * @return 加えたら [Unit]。読めなければ `null`
     */
    private fun codePoint(digits: String, builder: StringBuilder): Unit? {
        val value = digits.toIntOrNull(16)?.takeIf { digits.isNotEmpty() && it in 0..0x10FFFF } ?: return null
        builder.appendCodePoint(value)
        return Unit
    }

    /** `/` から始まる正規表現リテラル。行の中で閉じていなければ `null`。 */
    private fun regexLiteral(): JsValue? {
        var i = position + 1
        var inClass = false
        while (i < end && text[i] != '\n') {
            when (text[i]) {
                '\\' -> i++
                '[' -> inClass = true
                ']' -> inClass = false
                '/' -> if (!inClass) {
                    val pattern = text.substring(position + 1, i)
                    var flagEnd = i + 1
                    while (flagEnd < end && text[flagEnd].isLetter()) flagEnd++
                    val flags = text.substring(i + 1, flagEnd)
                    position = flagEnd
                    return JsRegex(pattern, flags)
                }
            }
            i++
        }
        return null
    }

    /** `true`、`false`。どちらでもなければ `null`（位置は進めない）。 */
    private fun keyword(): JsValue? {
        for ((word, value) in KEYWORDS) {
            val after = position + word.length
            if (after <= end && text.startsWith(word, position) &&
                (after == end || !text[after].isJavaIdentifierPart())
            ) {
                position = after
                return JsBoolean(value)
            }
        }
        return null
    }

    /** [position] から次の区切りまでを [JsOther] として読む。 */
    private fun other(): JsValue {
        val start = position
        skipExpression()
        return JsOther(text.substring(start, position).trim())
    }

    /**
     * [position] から、括弧の外の `,` か、閉じ括弧（`}`、`]`、`)`）の手前まで進める。
     * 括弧の中と文字列の中の区切りでは止まらない。
     */
    private fun skipExpression() {
        var depth = 0
        while (position < end) {
            val c = text[position]
            when {
                c == '"' || c == '\'' || c == '`' -> {
                    var i = position + 1
                    while (i < end && text[i] != c) i += if (text[i] == '\\') 2 else 1
                    position = minOf(i + 1, end)
                    continue
                }

                c == '(' || c == '[' || c == '{' -> depth++
                c == ')' || c == ']' || c == '}' -> if (depth-- == 0) return
                c == ',' && depth == 0 -> return
            }
            position++
        }
    }

    /** [position] から空白を読み飛ばす。 */
    private fun skipSpace() {
        while (position < end && text[position].isWhitespace()) position++
    }

    private companion object {
        /** 値の直後に来ると、値が式の全体であることを示す文字。 */
        val TERMINATORS = setOf(',', '}', ']', ')')

        /** 真偽値のキーワードと値。 */
        val KEYWORDS = listOf("true" to true, "false" to false)
    }
}
