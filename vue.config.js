const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  configureWebpack: {
    output: {
      hashFunction: "xxhash64"
    },
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
        }
      }
    }
  }
})
