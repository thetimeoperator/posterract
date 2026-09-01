/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* @refresh reload */
import { render } from 'solid-js/web'
import './index.css'
import App from './app'

document.addEventListener('contextmenu', (e) => e.preventDefault())

if (window.desktop) {
  document.documentElement.dataset.platform = window.desktop.platform;

  const origRequest = FileSystemHandle.prototype.requestPermission;
  FileSystemHandle.prototype.queryPermission = async function (desc) {
    try {
      return await origRequest.call(this, desc);
    } catch {
      return 'prompt';
    }
  };

}

const root = document.getElementById('root')

// Browser-hosted Create still supplies a project in the query string. Turn
// that one-time launch value into the same project route the desktop library
// uses, then remove it so navigating back really reaches the Projects page.
if (!window.location.hash) {
  const params = new URLSearchParams(window.location.search)
  const initialProject = params.get('project')
  if (initialProject) {
    params.delete('project')
    const query = params.toString()
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}#/projects/${encodeURIComponent(initialProject)}`
    window.history.replaceState(null, '', cleanUrl)
  }
}

render(() => <App />, root!)

// The packaged macOS app displays a lightweight splash before the renderer
// bundle mounts. Clear it after the first rendered frame so it cannot remain
// above an otherwise healthy editor indefinitely.
requestAnimationFrame(() => {
  document.documentElement.removeAttribute('data-boot')
})
