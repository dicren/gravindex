const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");

const DEV = process.env.VUE_APP_DEV === "true";

let optimizeOutput = {};
if (!DEV) {
  optimizeOutput = {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          output: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  };
}

module.exports = {
  integrity: true,
  productionSourceMap: DEV,
  css: {
    sourceMap: DEV,
    loaderOptions: {
      sass: {
        prependData: `
          @import "@/styles/bulma-customize/all";
          @import "~bulma/sass/utilities/functions";
          @import "~bulma/sass/utilities/initial-variables";
          @import "~bulma/sass/utilities/derived-variables";
          @import "~bulma/sass/utilities/mixins";`,
      },
    },
  },
  devServer: {
    disableHostCheck: true,
  },
  transpileDependencies: ["buefy"],
  configureWebpack: {
    optimization: {
      splitChunks: {
        chunks: "all",
      },
      ...optimizeOutput,
    },
    plugins: [
      new webpack.ContextReplacementPlugin(
        /moment[/\\]locale$/,
        /^(?!.*(es-us|es-do)).*es.*$/
      ),
    ],
  },
};
