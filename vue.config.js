const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  configureWebpack: {
    resolve: {
      fallback: {
        "fs": false,
        "path": require.resolve("path-browserify")
      }
    }
  },
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: false,
      builderOptions: {
        appId: "com.example.yourapp",
        productName: "Retro Studio",
        extends: null,
        win: {
          target: [
            {
              target: "nsis",
              arch: [
                "x64",
                "ia32"
              ]
            }
          ]
        },
        linux: {
          target: [
            {
              target: "AppImage",
              arch: [
                "x64",
                "ia32"
              ]
            }
          ]
        },
        extraResources: [
          {
            from: "docs",
            to: "docs",
            filter: ["**/*"]
          },
          {
            from: "src/toolkit",
            to: "toolkit",
            filter: ["**/*"]
          }
        ],
        files: [
          "**/*"
        ]
      }
    }
  }
})
