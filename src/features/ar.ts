/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {property} from 'lit-element';

import {IS_ANDROID, IS_AR_QUICKLOOK_CANDIDATE, IS_IOS, IS_WEBXR_AR_CANDIDATE} from '../constants.js';
import ModelViewerElementBase, {$renderer, $scene} from '../model-viewer-base.js';
import {Constructor, deserializeUrl} from '../utils.js';

/**
 * Takes a URL to a USDZ file and sets the appropriate fields so that Safari
 * iOS can intent to their AR Quick Look.
 */
export const openIOSARQuickLook = (() => {
  const anchor = document.createElement('a');
  anchor.setAttribute('rel', 'ar');
  anchor.appendChild(document.createElement('img'));

  return (usdzSrc: string) => {
    anchor.setAttribute('href', usdzSrc);
    anchor.click();
  };
})();

export const openARViewer = (() => {
  const anchor = document.createElement('a');

  return (gltfSrc: string, title: string) => {
    const location = window.location.toString();
    const modelUrl = new URL(gltfSrc);
    const link = encodeURIComponent(location);
    const scheme = modelUrl.protocol.replace(':', '');

    title = encodeURIComponent(title);
    modelUrl.protocol = 'intent://';

    const intent = `${modelUrl.toString()}?link=${link}&title=${
        title}#Intent;scheme=${
        scheme};package=com.google.ar.core;action=android.intent.action.VIEW;end;`;

    anchor.setAttribute('href', intent);
    anchor.click();
  };
})();

type ARMode = 'quick-look'|'ar-viewer'|'unstable-webxr'|'none';

const ARMode: {[index: string]: ARMode} = {
  QUICK_LOOK: 'quick-look',
  AR_VIEWER: 'ar-viewer',
  UNSTABLE_WEBXR: 'unstable-webxr',
  NONE: 'none'
};

const $arButton = Symbol('enterARElement');
const $enterARWithWebXR = Symbol('enterARWithWebXR');
const $canActivateAR = Symbol('canActivateAR');
const $arMode = Symbol('arMode');

const $arButtonClickHandler = Symbol('arButtonClickHandler');
const $onARButtonClick = Symbol('onARButtonClick');

export const ARMixin = (ModelViewerElement:
                            Constructor<ModelViewerElementBase>):
    Constructor<ModelViewerElementBase> => {
      class ARModelViewerElement extends ModelViewerElement {
        @property({attribute: 'ar', type: Boolean}) ar: boolean = false;

        @property({type: Boolean, attribute: 'unstable-webxr'})
        unstableWebxr: boolean = false;

        @property(
            {converter: {fromAttribute: deserializeUrl}, attribute: 'ios-src'})
        iosSrc: string|null = null;

        get canActivateAR(): boolean {
          return this[$arMode] !== ARMode.NONE;
        }

        protected[$canActivateAR]: boolean = false;

        // TODO: Add this to the shadow root as part of this mixin's
        // implementation:
        protected[$arButton]: HTMLAnchorElement =
            this.shadowRoot!.querySelector('.ar-button') as HTMLAnchorElement;

        protected[$arButtonClickHandler]:
            (event: Event) => void = (event) => this[$onARButtonClick](event);

        protected[$arMode]: ARMode = ARMode.NONE;

        constructor() {
          super();

          const renderer = this[$renderer];
          const scene = this[$scene];
          const onFullscreenchange = () => {
            if (document.fullscreenElement !== this &&
                renderer.presentedScene === scene) {
              try {
                renderer.stopPresenting();
              } catch (error) {
                console.warn('Unexpected error while stopping AR presentation');
                console.error(error);
              }
            }
          };

          document.addEventListener('fullscreenchange', onFullscreenchange);
        }

        /**
         * Activates AR. Note that for any mode that is not WebXR-based, this
         * method most likely has to be called synchronous from a user
         * interaction handler. Otherwise, attempts to activate modes that
         * require user interaction will most likely be ignored.
         */
        async activateAR() {
          switch (this[$arMode]) {
            case ARMode.QUICK_LOOK:
              openIOSARQuickLook(this.iosSrc!);
              break;
            case ARMode.UNSTABLE_WEBXR:
              await this[$enterARWithWebXR]();
              break;
            case ARMode.AR_VIEWER:
              this.requestFullscreen();
              openARViewer(this.src!, this.alt || '');
              break;
            default:
              console.warn(
                  'No AR Mode can be activated. This is probably due to missing \
configuration or device capabilities');
              break;
          }
        }

        protected async[$enterARWithWebXR]() {
          const renderer = this[$renderer];

          console.log('Attempting to enter fullscreen and present in AR...');

          try {
            const enterFullscreen = this.requestFullscreen();

            try {
              const outputElement = await renderer.present(this[$scene]);
              this.shadowRoot!.appendChild(outputElement);
              await enterFullscreen;
            } catch (error) {
              console.warn('Error while trying to present to AR');
              console.error(error);
              await enterFullscreen;
              if (document.fullscreenElement === this) {
                console.warn('Exiting fullscreen under dire circumstances');
                document.exitFullscreen();
              }
            }
          } catch (error) {
            console.error(error);
            console.warn('AR will not activate without fullscreen permission');
          }
        }

        async update(changedProperties: Map<string, any>) {
          super.update(changedProperties);

          if (!changedProperties.has('unstableWebxr') &&
              !changedProperties.has('iosSrc') &&
              !changedProperties.has('ar') && !changedProperties.has('src') &&
              !changedProperties.has('alt')) {
            return;
          }

          const renderer = this[$renderer];
          const unstableWebxrCandidate = this.unstableWebxr &&
              IS_WEBXR_AR_CANDIDATE && await renderer.supportsPresentation();
          const arViewerCandidate = IS_ANDROID && this.ar;
          const iosQuickLookCandidate =
              IS_IOS && IS_AR_QUICKLOOK_CANDIDATE && !!this.iosSrc;

          const showArButton = unstableWebxrCandidate || arViewerCandidate ||
              iosQuickLookCandidate;

          if (unstableWebxrCandidate) {
            this[$arMode] = ARMode.UNSTABLE_WEBXR;
          } else if (arViewerCandidate) {
            this[$arMode] = ARMode.AR_VIEWER;
          } else if (iosQuickLookCandidate) {
            this[$arMode] = ARMode.QUICK_LOOK;
          } else {
            this[$arMode] = ARMode.NONE;
          }

          if (showArButton) {
            this[$arButton].style.display = 'block';
            this[$arButton].addEventListener(
                'click', this[$arButtonClickHandler]);
          } else {
            this[$arButton].removeEventListener(
                'click', this[$arButtonClickHandler]);
            this[$arButton].style.display = 'none';
          }
        }

        [$onARButtonClick](event: Event) {
          event.preventDefault();
          this.activateAR();
        }
      }

      return ARModelViewerElement;
    }