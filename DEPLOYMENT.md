# Aethene Production Deployment Guide

This guide covers deploying Aethene to production with enterprise-grade reliability.

## Prerequisites

- Node.js 20+
- Convex account with deployed backend
- Gemini API key
- Domain with SSL certificate

## Environment Variables

Create a `.env.production` file:

```bash
# Required
NODE_ENV=production
PORT=3006
CONVEX_URL=https://your-convex-deployment.convex.cloud
GEMINI_API_KEY=your-gemini-api-key

# Security
CORS_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Optional - Monitoring
SENTRY_DSN=your-sentry-dsn
LOG_LEVEL=info
```

## Deployment Options

### Option 1: Docker (Recommended)

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY dist/ ./dist/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3006/health || exit 1

# Run
EXPOSE 3006
CMD ["node", "dist/server.js"]
```

Build and run:
```bash
npm run build
docker build -t aethene:latest .
docker run -d -p 3006:3006 --env-file .env.production aethene:latest
```

### Option 2: Fly.io

```toml
# fly.toml
app = "aethene-api"
primary_region = "iad"

[build]
  builder = "heroku/buildpacks:20"

[env]
  NODE_ENV = "production"
  PORT = "3006"

[http_service]
  internal_port = 3006
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1

[[services.http_checks]]
  interval = "30s"
  timeout = "10s"
  path = "/health"
  method = "GET"
```

Deploy:
```bash
fly launch
fly secrets set CONVEX_URL=xxx GEMINI_API_KEY=xxx
fly deploy
```

### Option 3: AWS ECS/Fargate

```yaml
# task-definition.json
{
  "family": "aethene",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "aethene",
      "image": "your-ecr-repo/aethene:latest",
      "portMappings": [
        {
          "containerPort": 3006,
          "protocol": "tcp"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3006/health || exit 1"],
        "interval": 30,
        "timeout": 10,
        "retries": 3,
        "startPeriod": 60
      },
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3006" }
      ],
      "secrets": [
        { "name": "CONVEX_URL", "valueFrom": "arn:aws:secretsmanager:..." },
        { "name": "GEMINI_API_KEY", "valueFrom": "arn:aws:secretsmanager:..." }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/aethene",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

### Option 4: Kubernetes

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aethene
spec:
  replicas: 3
  selector:
    matchLabels:
      app: aethene
  template:
    metadata:
      labels:
        app: aethene
    spec:
      containers:
        - name: aethene
          image: aethene:latest
          ports:
            - containerPort: 3006
          env:
            - name: NODE_ENV
              value: "production"
            - name: PORT
              value: "3006"
          envFrom:
            - secretRef:
                name: aethene-secrets
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3006
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health/deep
              port: 3006
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: aethene
spec:
  selector:
    app: aethene
  ports:
    - port: 80
      targetPort: 3006
  type: LoadBalancer
```

## Load Balancer Configuration

### Nginx

```nginx
upstream aethene {
    least_conn;
    server aethene-1:3006 weight=1;
    server aethene-2:3006 weight=1;
    server aethene-3:3006 weight=1;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name api.aethene.com;

    ssl_certificate /etc/ssl/certs/aethene.crt;
    ssl_certificate_key /etc/ssl/private/aethene.key;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/s;
    limit_req zone=api burst=200 nodelay;

    location / {
        proxy_pass http://aethene;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check (no rate limit)
    location /health {
        proxy_pass http://aethene;
        limit_req off;
    }
}
```

## Monitoring Setup

### Prometheus + Grafana

Aethene exposes metrics at `/metrics` in Prometheus format.

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'aethene'
    static_configs:
      - targets: ['aethene:3006']
    metrics_path: /metrics
    scrape_interval: 15s
```

### Key Metrics to Monitor

1. **Request Rate**: `aethene_requests_total`
2. **Error Rate**: `aethene_errors_total / aethene_requests_total`
3. **Latency P95**: `aethene_latency_avg_ms` (custom histogram recommended)
4. **Memory Searches**: `aethene_memory_searches_total`

### Alerting Rules

```yaml
# alerts.yml
groups:
  - name: aethene
    rules:
      - alert: HighErrorRate
        expr: rate(aethene_errors_total[5m]) / rate(aethene_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"

      - alert: HighLatency
        expr: aethene_latency_avg_ms > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High latency detected"

      - alert: ServiceDown
        expr: up{job="aethene"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Aethene service is down"
```

## Security Checklist

- [ ] SSL/TLS enabled (HTTPS only)
- [ ] CORS restricted to allowed origins
- [ ] Rate limiting configured
- [ ] API keys stored securely (not in code)
- [ ] Convex connection secured
- [ ] Secure headers enabled
- [ ] No sensitive data in logs
- [ ] Regular security audits (npm audit)

## Performance Tuning

### Node.js Settings

```bash
# Increase memory limit for large operations
export NODE_OPTIONS="--max-old-space-size=2048"

# Enable production optimizations
export NODE_ENV=production
```

### Scaling Guidelines

| Metric | Action |
|--------|--------|
| CPU > 80% sustained | Add more instances |
| Memory > 80% | Increase instance memory |
| P95 > 500ms | Check Convex/Gemini latency |
| Error rate > 1% | Check logs, scale if needed |

### Recommended Starting Configuration

| Environment | Instances | Memory | CPU |
|-------------|-----------|--------|-----|
| Development | 1 | 512MB | 0.25 |
| Staging | 2 | 1GB | 0.5 |
| Production | 3+ | 2GB | 1.0 |

## Backup & Recovery

### Database Backups

Convex handles database backups automatically. For additional safety:

1. Export data periodically via API
2. Store exports in S3/GCS with versioning
3. Test restore procedures quarterly

### Disaster Recovery

1. Deploy across multiple regions
2. Use database read replicas
3. Maintain runbooks for common failures
4. Test failover procedures

## Runbook

### Common Issues

#### High Latency
1. Check `/health/deep` for slow dependencies
2. Check Convex dashboard for query performance
3. Check Gemini API status
4. Scale horizontally if CPU-bound

#### Memory Errors
1. Check for memory leaks via `/metrics`
2. Restart affected instances
3. Increase memory limits
4. Review recent code changes

#### 5xx Errors
1. Check logs for stack traces
2. Verify environment variables
3. Check external service status
4. Roll back recent deployments if needed

## Support

- Documentation: https://docs.aethene.com
- Issues: https://github.com/aethene/aethene-api/issues
- Email: support@aethene.com
