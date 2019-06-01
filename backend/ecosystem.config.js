module.exports = {
  apps : [{
    name: 'gravindex-back',
    script: 'dist/main.js',

    args: '',
    instances: 1,
    autorestart: true,
    watch : ["dist"],
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'prod'
    }
  }]
};
