/* eslint-disable no-console */
/* @flow */
import path from 'path';


import {it, describe} from 'mocha';
import {fs} from 'mz';
import sinon from 'sinon';

import {default as onSourceChange, proxyFileChanges} from '../../src/watcher';
import {withTempDir} from '../../src/util/temp-dir';

type AssertWatchedParams = {
  shouldCreateWatchDir?: boolean,
  shouldTouchWatchDir?: boolean,
}

describe('watcher', () => {

  const watchChange = ({
    shouldCreateWatchDir,
    shouldTouchWatchDir = false,
  }: AssertWatchedParams = {}) => withTempDir(
    async (tmpDir) => {
      const artifactsDir = path.join(tmpDir.path(), 'web-ext-artifacts');
      let someFile = path.join(tmpDir.path(), 'foo.txt');

      let watchDirPath;
      if (shouldCreateWatchDir) {
        watchDirPath = path.join(tmpDir.path(), 'watchDir');
        await fs.mkdir(watchDirPath);
        console.log(`watchDirPath is ${ watchDirPath}`);

        if (shouldTouchWatchDir) {
          someFile = path.join(tmpDir.path(), 'watchDir', 'foo.txt');
        }
      }

      console.log(`someFile is ${ someFile}`);

      let resolveChange;
      const whenFilesChanged = new Promise((resolve) => {
        resolveChange = resolve;
      });
      const onChange = sinon.spy(() => {
        resolveChange();
      });

      await fs.writeFile(someFile, '<contents>');

      const watcher = await onSourceChange({
        sourceDir: tmpDir.path(),
        watchDir: watchDirPath,
        artifactsDir,
        onChange,
        shouldWatchFile: () => true,
      });

      await fs.utimes(someFile, Date.now() / 1000, Date.now() / 1000);

      await Promise.race([
        whenFilesChanged
          .then(() => {
            watcher.close();
            // This delay seems to avoid stat errors from the watcher
            // which can happen when the temp dir is deleted (presumably
            // before watcher.close() has removed all listeners).
            return new Promise((resolve) => {
              setTimeout(resolve, 2);
            });
          }),
        // Time out if no files are changed
        new Promise((resolve) => setTimeout(() => {
          watcher.close();
          resolve();
        }, 500)),
      ]);

      return onChange;
    }
  );

  it('watches for file changes', async () => {
    const onChange = await watchChange();
    sinon.assert.calledOnce(onChange);
  });

  describe.only('--watch-dir option is passed in', () => {
    it('changes if a file is touched in the watch dir', async () => {
      const onChange = await watchChange({
        shouldCreateWatchDir: true,
        shouldTouchWatchDir: true,
      });
      sinon.assert.calledOnce(onChange);
    });

    it('does not change if a file is touched in the watch dir', async () => {
      const onChange = await watchChange({
        shouldCreateWatchDir: true,
        shouldTouchWatchDir: false,
      });
      sinon.assert.notCalled(onChange);
    });
  });

  describe('proxyFileChanges', () => {

    const defaults = {
      artifactsDir: '/some/artifacts/dir/',
      onChange: () => {},
      shouldWatchFile: () => true,
    };

    it('proxies file changes', () => {
      const onChange = sinon.spy(() => {});
      proxyFileChanges({
        ...defaults,
        filePath: '/some/file.js',
        onChange,
      });
      sinon.assert.called(onChange);
    });

    it('ignores changes to artifacts', () => {
      const onChange = sinon.spy(() => {});
      proxyFileChanges({
        ...defaults,
        filePath: '/some/artifacts/dir/build.xpi',
        artifactsDir: '/some/artifacts/dir/',
        onChange,
      });
      sinon.assert.notCalled(onChange);
    });

    it('provides a callback for ignoring files', () => {

      function shouldWatchFile(filePath) {
        if (filePath === '/somewhere/freaky') {
          return false;
        } else {
          return true;
        }
      }

      const conf = {
        ...defaults,
        shouldWatchFile,
        onChange: sinon.spy(() => {}),
      };

      proxyFileChanges({...conf, filePath: '/somewhere/freaky'});
      sinon.assert.notCalled(conf.onChange);
      proxyFileChanges({...conf, filePath: '/any/file/'});
      sinon.assert.called(conf.onChange);
    });

  });

});
