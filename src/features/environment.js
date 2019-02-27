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

import {BackSide, BoxBufferGeometry, Color, Mesh, ShaderLib, ShaderMaterial, UniformsUtils} from 'three';

import {$needsRender, $onModelLoad, $renderer, $scene, $tick} from '../model-viewer-base.js';

import {IlluminationRole} from '../three-components/ModelScene.js';
const DEFAULT_BACKGROUND_COLOR = '#ffffff';
const DEFAULT_SHADOW_STRENGTH = 0.0;
const DEFAULT_EXPOSURE = 1.0;
const DEFAULT_STAGE_LIGHT_INTENSITY = 1.0;

const WHITE = new Color('#ffffff');

const $currentEnvironmentMap = Symbol('currentEnvironmentMap');
const $applyEnvironmentMap = Symbol('applyEnvironmentMap');
const $setEnvironmentImage = Symbol('setEnvironmentImage');
const $setEnvironmentColor = Symbol('setEnvironmentColor');
const $setShadowLightColor = Symbol('setShadowLightColor');
const $hasBackgroundImage = Symbol('hasBackgroundImage');
const $hasBackgroundColor = Symbol('hasBackgroundColor');
const $deallocateTextures = Symbol('deallocateTextures');
const $updateStageLighting = Symbol('updateStageLighting');
const $updateToneMapping = Symbol('updateToneMapping');
const $updateShadow = Symbol('updateShadow');

export const EnvironmentMixin = (ModelViewerElement) => {
  return class extends ModelViewerElement {
    static get properties() {
      return {
        ...super.properties,
        backgroundImage: {type: String, attribute: 'background-image'},
        backgroundColor: {type: String, attribute: 'background-color'},
        experimentalPmrem: {type: Boolean, attribute: 'experimental-pmrem'},
        shadowIntensity: {type: Number, attribute: 'shadow-intensity'},
        stageLightIntensity: {type: Number, attribute: 'stage-light-intensity'},
        exposure: {type: Number, attribute: 'exposure'}
      };
    }

    constructor(...args) {
      super(...args);
      this.shadowIntensity = DEFAULT_SHADOW_STRENGTH;
      this.stageLightIntensity = DEFAULT_STAGE_LIGHT_INTENSITY;
      this.exposure = DEFAULT_EXPOSURE;
    }

    get[$hasBackgroundImage]() {
      // @TODO #76
      return this.backgroundImage && this.backgroundImage !== 'null';
    }

    get[$hasBackgroundColor]() {
      // @TODO #76
      return this.backgroundColor && this.backgroundColor !== 'null';
    }

    update(changedProperties) {
      super.update(changedProperties);

      if (changedProperties.has('shadowIntensity')) {
        this[$updateShadow]();
      }

      if (changedProperties.has('exposure')) {
        this[$updateToneMapping]();
      }

      if (changedProperties.has('stageLightIntensity')) {
        this[$updateStageLighting]();
      }

      if (!changedProperties.has('backgroundImage') &&
          !changedProperties.has('backgroundColor') &&
          !changedProperties.has('experimentalPmrem')) {
        return;
      }

      if (this[$hasBackgroundImage]) {
        this[$setEnvironmentImage](this.backgroundImage);
      } else if (this[$hasBackgroundColor]) {
        this[$setEnvironmentColor](this.backgroundColor);
      } else {
        this[$setEnvironmentColor](DEFAULT_BACKGROUND_COLOR);
      }
    }

    firstUpdated(changedProperties) {
      if (!changedProperties.has('backgroundImage') &&
          !changedProperties.has('backgroundColor')) {
        this[$setEnvironmentColor](DEFAULT_BACKGROUND_COLOR);
      }
    }

    [$onModelLoad](e) {
      super[$onModelLoad](e);

      if (this[$currentEnvironmentMap]) {
        this[$applyEnvironmentMap](this[$currentEnvironmentMap]);
      }
    }

    /**
     * @param {string} url
     */
    async[$setEnvironmentImage](url) {
      const textureUtils = this[$renderer].textureUtils;

      if (textureUtils == null) {
        return;
      }

      const textures = await textureUtils.generateEnvironmentTextures(
          url, {pmrem: this.experimentalPmrem});

      // If the background image has changed
      // while fetching textures, abort and defer to that
      // invocation of this function.
      if (url !== this.backgroundImage) {
        return;
      }

      this[$deallocateTextures]();

      // If could not load textures (probably an invalid URL), then abort
      // after deallocating textures.
      if (!textures) {
        this[$applyEnvironmentMap](null);
        return;
      }

      const {skybox, environmentMap} = textures;

      this[$scene].background = skybox;

      this[$setShadowLightColor](WHITE);

      this[$applyEnvironmentMap](environmentMap);
    }

    /**
     * @param {string} color
     */
    [$setEnvironmentColor](color) {
      const textureUtils = this[$renderer].textureUtils;

      if (textureUtils == null) {
        return;
      }

      this[$deallocateTextures]();

      const parsedColor = new Color(color);

      this[$scene].background = parsedColor;

      this[$setShadowLightColor](parsedColor);

      // TODO(#336): can cache this per renderer and color
      const environmentMap = textureUtils.generateDefaultEnvironmentMap(
          {pmrem: this.experimentalPmrem});

      this[$applyEnvironmentMap](environmentMap);
    }

    /**
     * Sets the Model to use the provided environment map,
     * or `null` if the Model should remove its' environment map.
     *
     * @param {THREE.Texture} environmentMap
     */
    [$applyEnvironmentMap](environmentMap) {
      this[$currentEnvironmentMap] = environmentMap;
      this[$scene].model.applyEnvironmentMap(this[$currentEnvironmentMap]);
      this.dispatchEvent(new CustomEvent('environment-changed'));

      this[$updateStageLighting]();
      this[$needsRender]();
    }

    [$updateShadow]() {
      this[$scene].shadow.intensity = this.shadowIntensity;
      this[$needsRender]();
    }

    [$updateToneMapping]() {
      this[$renderer].exposure = this.exposure;
      this[$needsRender]();
    }

    [$updateStageLighting]() {
      const scene = this[$scene];
      const illuminationRole = this.experimentalPmrem ?
          IlluminationRole.Secondary :
          IlluminationRole.Primary;

      scene.configureStageLighting(this.stageLightIntensity, illuminationRole);
    }

    [$setShadowLightColor](color) {
      this[$scene].shadowLight.color.copy(color);
      this[$scene].shadowLight.color.lerpHSL(WHITE, 0.5);
    }

    [$deallocateTextures]() {
      const background = this[$scene].background;
      if (background && background.dispose) {
        background.dispose();
      }
      if (this[$currentEnvironmentMap]) {
        this[$currentEnvironmentMap].dispose();
        this[$currentEnvironmentMap] = null;
      }
    }
  }
};
