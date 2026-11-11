import {component, defineMarkdocConfig, nodes} from "@astrojs/markdoc/config";
import shiki from "@astrojs/markdoc/shiki";

export default defineMarkdocConfig({
    // コードブロックの色分け（extends の読み込みの確認用）
    extends: [shiki({theme: "github-dark"})],
    tags: {
        aside: {
            render: component("./src/components/Aside.astro"),
            attributes: {
                type: {type: String, default: "note", matches: ["note", "tip", "caution"]},
                title: {type: String},
            },
        },
        // 組み込みの image ノードの属性に width などを足したタグ
        image: {
            attributes: {
                ...nodes.image.attributes,
                width: {type: Number, required: true},
                height: {type: Number, required: true},
                caption: {type: String},
            },
            render: component("./src/components/MarkdocImage.astro"),
        },
    },
    nodes: {
        blockquote: {
            ...nodes.blockquote,
            render: component("./src/components/Quote.astro"),
        },
    },
    functions: {
        shout: {
            parameters: {0: {type: String, required: true}},
            transform(parameters) {
                return String(parameters[0]).toUpperCase();
            },
        },
    },
    variables: {
        environment: "development",
    },
});
