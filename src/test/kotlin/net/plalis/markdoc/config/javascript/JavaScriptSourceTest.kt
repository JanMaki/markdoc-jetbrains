package net.plalis.markdoc.config.javascript

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** [JavaScriptSource] と [JsValue] の読み取りのテスト。 */
class JavaScriptSourceTest {
    /** 既定の import の名前を、名前付きの import が続く形を含めて読む。 */
    @Test
    fun defaultImportName() {
        assertEquals("md", JavaScriptSource("import md from '@astrojs/markdoc';").defaultImportName("@astrojs/markdoc"))
        assertEquals(
            "md",
            JavaScriptSource("import md, { other } from \"@astrojs/markdoc\";").defaultImportName("@astrojs/markdoc"),
        )
        // コメントの中の import は読まない
        assertNull(JavaScriptSource("// import md from '@astrojs/markdoc';").defaultImportName("@astrojs/markdoc"))
        assertNull(JavaScriptSource("import md from 'other';").defaultImportName("@astrojs/markdoc"))
        // 文字列の中の import は読まず、その後の import を読む
        assertEquals(
            "md",
            JavaScriptSource("const s = \"import x from '@astrojs/markdoc'\";\nimport md from '@astrojs/markdoc';")
                .defaultImportName("@astrojs/markdoc"),
        )
    }

    /** 呼び出しの括弧の中を、文字列の中身とコメントを空白にした形で返す。 */
    @Test
    fun callArgumentCode() {
        val source = JavaScriptSource(
            """
            f({ "a": 1, b: ")" /* f(c) */ }, g(2));
            xf(3); o.f(4);
            """.trimIndent(),
        )
        val arguments = source.callArgumentCode("f")
        assertEquals(1, arguments.size)
        assertEquals("{  a : 1, b: \" \"            }, g(2)", arguments.single())
    }

    /** 正規表現リテラルの中の括弧とコメントの始まりの形を、呼び出しの括弧やコメントとして読まない。 */
    @Test
    fun regexLiteral() {
        val source = JavaScriptSource("""f({ a: /\/*[)/]/g, b: x / 2 / 3, c: true }); g(1);""")
        assertEquals(1, source.callArgumentCode("g").size)
        val options = source.firstArguments("f").single() as JsObject
        assertEquals(JsRegex("""\/*[)/]""", "g"), options["a"])
        assertEquals(JsBoolean(true), options["c"])
    }

    /** 最初の引数のリテラルを読む。 */
    @Test
    fun firstArguments() {
        val source = JavaScriptSource(
            """
            withMarkdoc({
              schemaPath: './schema', // コメント
              'mode': "static",
              extension: /\.(md|mdoc)$/i,
              options: { allowComments: false, slots: true },
              list: [`a`, 'b\n', true,],
              ...rest,
              [computed]: 1,
              method() { return 1 },
              shorthand,
              expression: a ? 'x' : 'y',
              template: `x${'$'}{y}`,
            })(config);
            withMarkdoc();
            """.trimIndent(),
        )
        val (first, second) = source.firstArguments("withMarkdoc")
        val options = first as JsObject
        assertEquals(JsString("./schema"), options["schemaPath"])
        assertEquals(JsString("static"), options["mode"])
        assertEquals(JsRegex("""\.(md|mdoc)$""", "i"), options["extension"])
        assertEquals(
            JsObject(mapOf("allowComments" to JsBoolean(false), "slots" to JsBoolean(true))),
            options["options"],
        )
        assertEquals(JsArray(listOf(JsString("a"), JsString("b\n"), JsBoolean(true))), options["list"])
        assertEquals(JsOther("a ? 'x' : 'y'"), options["expression"])
        assertEquals(JsOther("`x\${y}`"), options["template"])
        assertEquals(
            listOf("schemaPath", "mode", "extension", "options", "list", "expression", "template"),
            options.properties.keys.toList(),
        )
        assertNull(second)
    }

    /** リテラルでない引数と、閉じていない呼び出しは [JsOther] にする。 */
    @Test
    fun nonLiteralArguments() {
        assertEquals(listOf(JsOther("options")), JavaScriptSource("f(options)").firstArguments("f"))
        assertEquals(listOf(JsOther("'a' + b")), JavaScriptSource("f('a' + b, 2)").firstArguments("f"))
        assertEquals(listOf(JsOther("{ a: 1")), JavaScriptSource("f({ a: 1").firstArguments("f"))
        assertEquals(listOf(JsOther("{ ]")), JavaScriptSource("f({ ] })").firstArguments("f"))
    }

    /** 文字列のエスケープを戻す。 */
    @Test
    fun stringEscapes() {
        // `\u` の後に 16 進数が続く形はソースに直接書けないので、バックスラッシュを別に足す
        val backslash = "\\"
        val text = "f(\"a\\\"b${backslash}u0041\\x42${backslash}u{1F600}\\\\\\n\")"
        val value = JavaScriptSource(text).firstArguments("f").single()
        assertEquals(JsString("a\"bAB" + String(Character.toChars(0x1F600)) + "\\\n"), value)
    }
}
