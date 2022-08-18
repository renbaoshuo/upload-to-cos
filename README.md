# GitHub Action for upload files to Tencent Cloud COS

Upload files in a directory to Tencent Cloud COS with a prefix incrementally, with filename filter.

Incremental upload is implemented by comparing local MD5 and remote `eTag` (`eTag` = MD5 when uploaded with `PutObject`).

## Usage

```yaml
jobs:
  build-and-deploy:
    name: Build and Deploy website to COS
    runs-on: ubuntu-latest
    steps:
      - name: Check out
        uses: actions/checkout@v2
      # ... build your static website
      - uses: renbaoshuo/upload-to-cos@beta-v1
        with:
          # Use SecretId and SecretKey
          secret-id: ${{ secrets.QCLOUD_SECRET_ID }}
          secret-key: ${{ secrets.QCLOUD_SECRET_KEY }}

          bucket: ${{ secrets.ALIYUN_OSS_BUCKET }}
          endpoint: ${{ secrets.ALIYUN_OSS_ENDPOINT }}

          # Upload the built website files in "dist" directory to remote "my-website/" prefix
          local-path: dist
          remote-path: my-website

          # Include HTML files only
          include-regex: \.html$
          # Exclude some files
          excluce-regex: dont-upload-this\.html$

          # Upload ALL other files before uploading HTML files
          delay-html-file-upload: true

          # Prevent deleting missing remote files compared to local (defaults to `false`)
          no-delete-remote-files: true

          # Retry 5 times on failure of each OSS operation
          retry: 5

          # Use increment or not
          increment: true
```

## Author

**upload-to-cos** © [Baoshuo](https://github.com/renbaoshuo), Released under the [MIT](./LICENSE) License.<br>
Authored and maintained by Baoshuo with help from [contributors](https://github.com/renbaoshuo/upload-to-cos/contributors).

> [Personal Website](https://baoshuo.ren) · [Blog](https://blog.baoshuo.ren) · GitHub [@renbaoshuo](https://github.com/renbaoshuo) · Twitter [@renbaoshuo](https://twitter.com/renbaoshuo)
