const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const winston = require('winston');
require('dotenv').config();

const paymentRoutes = require('./api/payments');
const reconciliationRoutes = require('./api/reconciliation');
const payrollRoutes = require('./api/payroll');
const complianceRoutes = require('./api/compliance');
const embeddedRoutes = require('./api/embedded');
const healthRoutes = require('./api/health');

const errorHandler = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');
const validationMiddleware = require('./middleware/validation');
const auditMiddleware = require('./middleware/audit');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'globalpay-platform' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // requests per window
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.headers['x-api-key'] || req.ip;
  }
});

app.use(limiter);

// General middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || require('uuid').v4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Audit middleware for all requests
app.use(auditMiddleware);

// Health check (no auth required)
app.use('/health', healthRoutes);

// API documentation
if (process.env.NODE_ENV !== 'production') {
  const swaggerJsDoc = require('swagger-jsdoc');
  const swaggerUi = require('swagger-ui-express');

  const swaggerOptions = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'GlobalPay Platform API',
        version: '1.0.0',
        description: 'Enterprise payment platform with real-time rails, embedded finance, and global payroll',
        contact: {
          name: 'GlobalPay API Support',
          email: 'api-support@globalpay.com',
          url: 'https://docs.globalpay.com'
        }
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server'
        },
        {
          url: 'https://api-sandbox.globalpay.com',
          description: 'Sandbox server'
        },
        {
          url: 'https://api.globalpay.com',
          description: 'Production server'
        }
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          },
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key'
          }
        }
      },
      security: [
        { BearerAuth: [] },
        { ApiKeyAuth: [] }
      ]
    },
    apis: ['./src/api/*.js', './src/models/*.js']
  };

  const swaggerSpec = swaggerJsDoc(swaggerOptions);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "GlobalPay API Documentation"
  }));
}

// Authentication middleware for API routes
app.use('/api', authMiddleware);

// API routes
app.use('/api/payments', paymentRoutes);
app.use('/api/reconciliation', reconciliationRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/compliance', complianceRoutes);
app.use('/api/embedded', embeddedRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Resource not found',
    message: `The requested endpoint ${req.originalUrl} does not exist`,
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`GlobalPay Platform API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.info(`API Documentation: http://localhost:${PORT}/api-docs`);
  }
});

module.exports = app;