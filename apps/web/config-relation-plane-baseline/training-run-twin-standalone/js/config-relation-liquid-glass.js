/*
 * Liquid Glass — optical backdrop refraction for the canvas overlays.
 * Adapted from https://github.com/rizzytoday/liquid-glass (MIT License).
 * The parameter profile intentionally matches npu-memory-atlas/index_comm.html.
 */
(() => {
  "use strict";

  const SELECTOR = ".crop-tools,.crop-heat__legend.crop-memory-legend";
  const isChromium = typeof navigator !== "undefined" && /Chrome\//.test(navigator.userAgent);
  const mapCache = new Map();
  const instances = new Map();
  let instanceCount = 0;

  function resolveConfig(element, options) {
    const rect = element.getBoundingClientRect();
    const aberration = options.aberration ?? [0, 10, 20];
    return {
      width: options.width ?? Math.round(rect.width),
      height: options.height ?? Math.round(rect.height),
      radius: options.borderRadius ?? 50,
      scale: options.scale ?? -180,
      border: options.border ?? 0.07,
      lightness: options.lightness ?? 50,
      alpha: options.alpha ?? 0.93,
      blur: options.blur ?? 11,
      red: aberration[0],
      green: aberration[1],
      blue: aberration[2],
      saturation: options.saturation ?? 1,
      displace: options.displaceBlur ?? 0,
    };
  }

  function buildDisplacementMap(config) {
    const key = [
      config.width,
      config.height,
      config.radius,
      config.scale,
      config.border,
      config.blur,
      config.lightness,
      config.alpha,
    ].join(":");
    if (mapCache.has(key)) return mapCache.get(key);

    const maxDisplace = Math.max(Math.abs(config.scale) * 0.5, 20);
    const padX = Math.ceil(maxDisplace);
    const padY = Math.ceil(maxDisplace);
    const canvas = document.createElement("canvas");
    canvas.width = config.width + padX * 2;
    canvas.height = config.height + padY * 2;
    const context = canvas.getContext("2d");
    if (!context) return "";

    context.fillStyle = "rgb(128, 128, 128)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.beginPath();
    context.roundRect(padX, padY, config.width, config.height, config.radius);
    context.clip();
    context.fillStyle = "#000";
    context.fillRect(padX, padY, config.width, config.height);

    const redGradient = context.createLinearGradient(
      padX + config.width, padY, padX, padY,
    );
    redGradient.addColorStop(0, "#000");
    redGradient.addColorStop(1, "#f00");
    context.fillStyle = redGradient;
    context.fillRect(padX, padY, config.width, config.height);

    context.globalCompositeOperation = "difference";
    const blueGradient = context.createLinearGradient(
      padX, padY, padX, padY + config.height,
    );
    blueGradient.addColorStop(0, "#000");
    blueGradient.addColorStop(1, "#00f");
    context.fillStyle = blueGradient;
    context.fillRect(padX, padY, config.width, config.height);

    context.globalCompositeOperation = "source-over";
    const borderPixels = Math.min(config.width, config.height) * (config.border * 0.5);
    context.filter = `blur(${config.blur}px)`;
    context.fillStyle = `hsla(0, 0%, ${config.lightness}%, ${config.alpha})`;
    context.beginPath();
    context.roundRect(
      padX + borderPixels,
      padY + borderPixels,
      config.width - borderPixels * 2,
      config.height - borderPixels * 2,
      config.radius,
    );
    context.fill();
    context.restore();

    const uri = canvas.toDataURL();
    mapCache.set(key, uri);
    return uri;
  }

  function createFilterSvg(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
    svg.innerHTML = `
      <defs>
        <filter id="${id}" color-interpolation-filters="sRGB">
          <feImage result="map" preserveAspectRatio="none"></feImage>
          <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" result="dispRed" data-channel="red"></feDisplacementMap>
          <feColorMatrix in="dispRed" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"></feColorMatrix>
          <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" result="dispGreen" data-channel="green"></feDisplacementMap>
          <feColorMatrix in="dispGreen" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"></feColorMatrix>
          <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" result="dispBlue" data-channel="blue"></feDisplacementMap>
          <feColorMatrix in="dispBlue" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"></feColorMatrix>
          <feBlend in="red" in2="green" mode="screen" result="redGreen"></feBlend>
          <feBlend in="redGreen" in2="blue" mode="screen" result="output"></feBlend>
          <feGaussianBlur in="output" stdDeviation="0"></feGaussianBlur>
        </filter>
      </defs>`;
    return {
      svg,
      filter: svg.querySelector("filter"),
      image: svg.querySelector("feImage"),
      red: svg.querySelector('[data-channel="red"]'),
      green: svg.querySelector('[data-channel="green"]'),
      blue: svg.querySelector('[data-channel="blue"]'),
      blur: svg.querySelector("feGaussianBlur"),
    };
  }

  function applyConfig(config, refs) {
    const uri = buildDisplacementMap(config);
    const maxDisplace = Math.max(Math.abs(config.scale) * 0.5, 20);
    const percentX = Math.ceil(maxDisplace / config.width * 100);
    const percentY = Math.ceil(maxDisplace / config.height * 100);
    refs.filter.setAttribute("x", `-${percentX}%`);
    refs.filter.setAttribute("y", `-${percentY}%`);
    refs.filter.setAttribute("width", `${100 + percentX * 2}%`);
    refs.filter.setAttribute("height", `${100 + percentY * 2}%`);
    refs.image.setAttributeNS("http://www.w3.org/1999/xlink", "href", uri);
    refs.image.setAttribute("href", uri);
    refs.red.setAttribute("scale", String(config.scale + config.red));
    refs.green.setAttribute("scale", String(config.scale + config.green));
    refs.blue.setAttribute("scale", String(config.scale + config.blue));
    refs.blur.setAttribute("stdDeviation", String(config.displace));
  }

  function glassOptions(element) {
    const rect = element.getBoundingClientRect();
    const radius = Math.min(
      Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
      rect.width / 2,
      rect.height / 2,
    );
    return {
      borderRadius: radius,
      scale: -110,
      aberration: [0, 4, 8],
      alpha: 1,
      blur: 8,
      displaceBlur: 4,
      saturation: 1,
      fallbackFilter: "blur(12px)",
    };
  }

  function createLiquidGlass(element) {
    const options = glassOptions(element);
    if (!isChromium) {
      const previous = element.style.backdropFilter;
      const previousWebkit = element.style.getPropertyValue("-webkit-backdrop-filter");
      element.style.backdropFilter = options.fallbackFilter;
      element.style.setProperty("-webkit-backdrop-filter", options.fallbackFilter);
      return {
        destroy() {
          element.style.backdropFilter = previous;
          element.style.setProperty("-webkit-backdrop-filter", previousWebkit);
        },
      };
    }

    const id = `crop-liquid-glass-${++instanceCount}`;
    const refs = createFilterSvg(id);
    document.body.appendChild(refs.svg);
    let config = resolveConfig(element, options);
    applyConfig(config, refs);

    const applyStyles = () => {
      const filter = `url(#${id}) saturate(${config.saturation})`;
      element.style.backdropFilter = filter;
      element.style.setProperty("-webkit-backdrop-filter", filter);
    };
    applyStyles();

    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        config = resolveConfig(element, options);
        applyConfig(config, refs);
        applyStyles();
      });
    });
    resizeObserver.observe(element);

    return {
      destroy() {
        resizeObserver.disconnect();
        cancelAnimationFrame(resizeFrame);
        refs.svg.remove();
        element.style.backdropFilter = "";
        element.style.setProperty("-webkit-backdrop-filter", "");
      },
    };
  }

  function syncGlass() {
    for (const element of document.querySelectorAll(SELECTOR)) {
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0
        && rect.height > 0
        && getComputedStyle(element).visibility !== "hidden";
      if (visible && !instances.has(element)) {
        instances.set(element, createLiquidGlass(element));
      } else if (!visible && instances.has(element)) {
        instances.get(element).destroy();
        instances.delete(element);
      }
    }
  }

  function start() {
    syncGlass();
    const observer = new MutationObserver(syncGlass);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden", "class"],
    });
    window.addEventListener("resize", syncGlass);
    window.addEventListener("pagehide", () => {
      observer.disconnect();
      window.removeEventListener("resize", syncGlass);
      for (const instance of instances.values()) instance.destroy();
      instances.clear();
    }, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
