const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = ({ config }) => {
  if (!existsSync(resolve(__dirname, 'google-services.json'))) return config;
  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: './google-services.json'
    }
  };
};
