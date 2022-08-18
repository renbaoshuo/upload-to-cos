const core = require('@actions/core');
const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const Path = require('path');
const { createHash } = require('crypto');

const maxRetryCount = Number(core.getInput('retry'));

const walk = async (path, walkFn) => {
  stats = await fs.promises.lstat(path);
  if (!stats.isDirectory()) {
    return await walkFn(path);
  }

  const dir = await fs.promises.opendir(path);
  for await (const dirent of dir) {
    await walk(Path.join(path, dirent.name), walkFn);
  }
};

const withRetry = async (operation) => {
  let retry = maxRetryCount;
  if (!Number.isSafeInteger(retry) && retry > 0) retry = 5;

  for (let i = 1; i <= retry; i++) {
    try {
      return await operation();
    } catch (e) {
      if (i !== retry) {
        console.error(`Retrying for the ${i}-th time on`, e);
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
      } else {
        throw e;
      }
    }
  }
};

const uploadFileToCOS = (cos, path) =>
  withRetry(
    () =>
      new Promise((resolve, reject) => {
        cos.cli.putObject(
          {
            Bucket: cos.bucket,
            Region: cos.region,
            Key: Path.join(cos.remotePath, path),
            StorageClass: 'STANDARD',
            Body: fs.createReadStream(Path.join(cos.localPath, path)),
          },
          function (err, data) {
            if (err) {
              return reject(err);
            } else {
              return resolve(data);
            }
          }
        );
      })
  );

const deleteFileFromCOS = (cos, path) =>
  withRetry(
    () =>
      new Promise((resolve, reject) => {
        cos.cli.deleteObject(
          {
            Bucket: cos.bucket,
            Region: cos.region,
            Key: Path.join(cos.remotePath, path),
          },
          function (err, data) {
            if (err) {
              return reject(err);
            } else {
              return resolve(data);
            }
          }
        );
      })
  );

const listFilesOnCOS = (cos, nextMarker) =>
  withRetry(
    () =>
      new Promise((resolve, reject) => {
        cos.cli.getBucket(
          {
            Bucket: cos.bucket,
            Region: cos.region,
            Prefix: cos.remotePath,
            NextMarker: nextMarker,
          },
          function (err, data) {
            if (err) {
              return reject(err);
            } else {
              return resolve(data);
            }
          }
        );
      })
  );

const collectLocalFiles = async (cos) => {
  const root = cos.localPath;
  const files = new Map();

  const includeRegex = new RegExp(input.include);
  const excludeRegex = new RegExp(input.exclude);

  await walk(root, (path) => {
    let p = path.substring(root.length);
    for (; p[0] === '/'; ) {
      p = p.substring(1);
    }

    if (!includeRegex.test(p) || excludeRegex.test(p)) {
      console.log(`Skipping local file ${JSON.stringify(p)}`);
      return;
    }

    const md5 = createHash('md5').update(fs.readFileSync(path)).digest('hex');

    files.set(p, md5);
  });
  return files;
};

const uploadFiles = async (cos, localFiles) => {
  const size = localFiles.length;
  let index = 0;
  let percent = 0;

  for (const file of localFiles) {
    await uploadFileToCOS(cos, file);
    index++;
    percent = parseInt((index / size) * 100);
    console.log(
      `>> [${index}/${size}, ${percent}%] uploaded ${Path.join(
        cos.localPath,
        file
      )}`
    );
  }
};

const collectRemoteFiles = async (cos) => {
  const files = new Map();
  let data = {};
  let nextMarker = null;

  do {
    data = await listFilesOnCOS(cos, nextMarker);
    for (const e of data.Contents) {
      let p = e.Key.substring(cos.remotePath.length);
      for (; p[0] === '/'; ) {
        p = p.substring(1);
      }
      files.set(p, e.ETag.split('"').join(''));
    }

    nextMarker = data.NextMarker;
  } while (data.IsTruncated === 'true');

  return files;
};

const findDeletedFiles = (localFiles, remoteFiles) => {
  const deletedFiles = new Set();
  for (const file of remoteFiles) {
    if (!localFiles.has(file)) {
      deletedFiles.add(file);
    }
  }
  return deletedFiles;
};

const cleanDeleteFiles = async (cos, deleteFiles) => {
  const size = deleteFiles.size;
  let index = 0;
  let percent = 0;
  for (const file of deleteFiles) {
    await deleteFileFromCOS(cos, file);
    index++;
    percent = parseInt((index / size) * 100);
    console.log(
      `>> [${index}/${size}, ${percent}%] cleaned ${Path.join(
        cos.remotePath,
        file
      )}`
    );
  }
};

const process = async (cos) => {
  const local = await collectLocalFiles(cos);
  const remote = await collectRemoteFiles(cos);

  const localFiles = Array.from(local.entries())
    .filter(([file, md5]) => !cos.incremental || remote.get(file) !== md5)
    .map(([k]) => k);

  console.log(localFiles.length, 'files to be uploaded');

  for (const currentUploadList of cos.delayHtmlFileUpload
    ? [
        localFiles.filter((file) => !file.toLowerCase().endsWith('.html')),
        localFiles.filter((file) => file.toLowerCase().endsWith('.html')),
      ]
    : [localFiles]) {
    await uploadFiles(cos, currentUploadList);
  }

  let cleanedFilesCount = 0;
  if (cos.clean) {
    const remoteFiles = Object.keys(remote);
    const deletedFiles = findDeletedFiles(localFiles, remoteFiles);

    if (deletedFiles.length > 0) {
      console.log(`${deletedFiles.length} files to be cleaned`);
    }

    await cleanDeleteFiles(cos, deletedFiles);
    cleanedFilesCount = deletedFiles.length;
  }

  let cleanedFilesMessage = '';
  if (cleanedFilesCount > 0) {
    cleanedFilesMessage = `, cleaned ${cleanedFilesCount} files`;
  }

  console.log(`uploaded ${localFiles.length} files${cleanedFilesMessage}`);
};

try {
  const cos = {
    cli: new COS({
      SecretId: core.getInput('secret-id'),
      SecretKey: core.getInput('secret-key'),
      Domain: core.getBooleanInput('accelerate')
        ? '{Bucket}.cos.accelerate.myqcloud.com'
        : undefined,
    }),
    bucket: core.getInput('bucket'),
    region: core.getInput('region'),
    localPath: core.getInput('local-path'),
    remotePath: core.getInput('remote-path'),
    clean: !core.getBooleanInput('no-delete-remote-files'),
    delayHtmlFileUpload: core.getBooleanInput('delay-html-file-upload'),
    incremental: core.getBooleanInput('incremental'),
  };

  process(cos).catch((reason) => {
    core.setFailed(`fail to upload files to cos: ${reason.message}`);
  });
} catch (error) {
  core.setFailed(error.message);
}
