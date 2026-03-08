module.exports = {
  apps: [{
    name: 'whatsapp-bot',
    script: './index.js',
    
    // Auto-restart configuration
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    
    // Restart delays
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    
    // Error handling
    exp_backoff_restart_delay: 100,
    
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    
    // Environment
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Jakarta'
    },
    
    // Kill timeout
    kill_timeout: 5000,
    
    // Restart conditions
    wait_ready: false,
    listen_timeout: 10000,
    
    // Cron restart (optional - restart every day at 3 AM)
    cron_restart: '0 3 * * *',
    
    // Node arguments
    node_args: '--max-old-space-size=1024'
  }]
};