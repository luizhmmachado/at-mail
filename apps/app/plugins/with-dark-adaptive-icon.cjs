const path = require('node:path');
const fs = require('node:fs/promises');
const { AndroidConfig, withAndroidColorsNight, withDangerousMod } = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

module.exports = function withDarkAdaptiveIcon(config) {
  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: 'iconBackground', value: '#000000'
    });
    return mod;
  });
  return withDangerousMod(config, ['android', async (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const res = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
    // Night PNGs would otherwise take precedence over the default adaptive XML.
    const adaptive = path.join(res, 'mipmap-night-anydpi-v26');
    await fs.mkdir(adaptive, { recursive: true });
    await Promise.all(['ic_launcher.xml', 'ic_launcher_round.xml'].map((file) =>
      fs.copyFile(path.join(res, 'mipmap-anydpi-v26', file), path.join(adaptive, file))
    ));
    await Promise.all(Object.entries(densities).map(async ([density, scale]) => {
      // Android requires the night qualifier before the density qualifier.
      const destination = path.join(res, `mipmap-night-${density}`);
      await fs.mkdir(destination, { recursive: true });
      const resize = async (file, baseline) => (await generateImageAsync(
        { projectRoot, cacheType: 'atmail-dark-icons' },
        { src: path.join(projectRoot, 'assets', file), width: Math.round(baseline * scale),
          height: Math.round(baseline * scale), resizeMode: 'contain', backgroundColor: 'transparent' }
      )).source;
      const [foreground, legacy] = await Promise.all([
        resize('adaptive-icon-dark.png', 108), resize('icon-dark.png', 48)
      ]);
      await Promise.all([
        fs.writeFile(path.join(destination, 'ic_launcher_foreground.png'), foreground),
        fs.writeFile(path.join(destination, 'ic_launcher.png'), legacy),
        fs.writeFile(path.join(destination, 'ic_launcher_round.png'), legacy)
      ]);
    }));
    return mod;
  }]);
};
