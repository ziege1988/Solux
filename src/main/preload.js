'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('solux', {
  getConfig: inv('config:get'),
  setConfig: inv('config:set'),
  refresh: inv('data:refresh'),
  sunImage: inv('data:sun'),
  regions: inv('data:regions'),
  regionHistory: inv('data:regionHistory'),
  news: inv('data:news'),
  weather: inv('data:weather'),
  rateSeeing: inv('data:rateSeeing'),
  storeInfo: inv('data:storeInfo'),
  clearImages: inv('data:clearImages'),
  geoSearch: inv('geo:search'),
  quit: inv('app:quit'),
  openRecordings: inv('app:openRecordings'),
  hideWidget: inv('app:hideWidget'),
  openExternal: inv('app:openExternal'),
  showLog: inv('app:showLog'),
  rec: {
    openDialog: inv('rec:openDialog'),
    load: inv('rec:load'),
    chooseFolder: inv('rec:chooseFolder'),
    save: inv('rec:save'),
    reveal: inv('rec:reveal'),
    profileUpdate: inv('rec:profileUpdate'),
    profileReset: inv('rec:profileReset'),
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  update: { check: inv('update:check'), install: inv('update:install') },
  on: (channel, fn) => {
    const allowed = ['data-updated', 'show-settings', 'update-available', 'update-progress', 'recordings-opened', 'recordings-closed'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, p) => fn(p);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
