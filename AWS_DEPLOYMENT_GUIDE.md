# GlobalPay Platform - AWS Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [AWS Services Configuration](#aws-services-configuration)
4. [Infrastructure Setup](#infrastructure-setup)
5. [Application Deployment](#application-deployment)
6. [Security Configuration](#security-configuration)
7. [Monitoring and Logging](#monitoring-and-logging)
8. [Disaster Recovery](#disaster-recovery)
9. [Cost Optimization](#cost-optimization)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools
- AWS CLI (v2.x or higher)
- AWS CDK or Terraform (for Infrastructure as Code)
- Docker (v20.x or higher)
- kubectl (v1.27 or higher)
- Node.js (v18.x or higher)
- PostgreSQL client tools
- Git

### AWS Account Requirements
- AWS Account with appropriate billing setup
- IAM user with administrator access (for initial setup)
- AWS Organizations setup (recommended for multi-account strategy)
- Service quotas increased for:
  - EC2 instances (minimum 50 vCPUs)
  - RDS instances (minimum 10)
  - EKS clusters (minimum 2)
  - VPC (minimum 5)

### Required AWS Certifications/Compliance
- PCI DSS Level 1 compliant environment
- SOC 2 Type II attestation
- HIPAA compliance (if handling health benefits)

---

## Architecture Overview

### Multi-Region Architecture
GlobalPay deploys across multiple AWS regions for high availability and compliance:

**Primary Region**: us-east-1 (N. Virginia)
**Secondary Region**: eu-west-1 (Ireland)
**Tertiary Region**: ap-southeast-2 (Sydney)

### Core AWS Services Used
- **Compute**: Amazon EKS, AWS Fargate, Lambda
- **Storage**: Amazon RDS (PostgreSQL), Amazon ElastiCache (Redis), Amazon S3
- **Networking**: Amazon VPC, AWS Transit Gateway, AWS PrivateLink
- **Security**: AWS KMS, AWS Secrets Manager, AWS WAF, AWS Shield
- **Messaging**: Amazon MSK (Kafka), Amazon SQS, Amazon SNS
- **CDN**: Amazon CloudFront
- **Monitoring**: Amazon CloudWatch, AWS X-Ray
- **DNS**: Amazon Route 53

---

## AWS Services Configuration

### 1. Virtual Private Cloud (VPC) Setup

#### VPC Architecture
```bash
# Create VPC
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=globalpay-prod-vpc}]'

# Enable DNS hostnames
aws ec2 modify-vpc-attribute \
  --vpc-id <VPC_ID> \
  --enable-dns-hostnames
```

#### Subnet Configuration
```bash
# Public Subnets (for ALB, NAT Gateway)
# us-east-1a
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.1.0/24 \
  --availability-zone us-east-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=public-subnet-1a}]'

# us-east-1b
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.2.0/24 \
  --availability-zone us-east-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=public-subnet-1b}]'

# us-east-1c
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.3.0/24 \
  --availability-zone us-east-1c \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=public-subnet-1c}]'

# Private Subnets (for EKS, RDS)
# us-east-1a
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.11.0/24 \
  --availability-zone us-east-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=private-subnet-1a}]'

# us-east-1b
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.12.0/24 \
  --availability-zone us-east-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=private-subnet-1b}]'

# us-east-1c
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.13.0/24 \
  --availability-zone us-east-1c \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=private-subnet-1c}]'

# Database Subnets (isolated)
# us-east-1a
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.21.0/24 \
  --availability-zone us-east-1a \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=db-subnet-1a}]'

# us-east-1b
aws ec2 create-subnet \
  --vpc-id <VPC_ID> \
  --cidr-block 10.0.22.0/24 \
  --availability-zone us-east-1b \
  --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=db-subnet-1b}]'
```

#### Internet Gateway and NAT Gateway
```bash
# Create and attach Internet Gateway
aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=globalpay-igw}]'

aws ec2 attach-internet-gateway \
  --internet-gateway-id <IGW_ID> \
  --vpc-id <VPC_ID>

# Allocate Elastic IPs for NAT Gateways
aws ec2 allocate-address --domain vpc

# Create NAT Gateway in each AZ
aws ec2 create-nat-gateway \
  --subnet-id <PUBLIC_SUBNET_1A_ID> \
  --allocation-id <EIP_ALLOCATION_ID> \
  --tag-specifications 'ResourceType=nat-gateway,Tags=[{Key=Name,Value=nat-gateway-1a}]'
```

#### Route Tables
```bash
# Public route table
aws ec2 create-route-table \
  --vpc-id <VPC_ID> \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=public-rt}]'

aws ec2 create-route \
  --route-table-id <PUBLIC_RT_ID> \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id <IGW_ID>

# Private route table
aws ec2 create-route-table \
  --vpc-id <VPC_ID> \
  --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=private-rt}]'

aws ec2 create-route \
  --route-table-id <PRIVATE_RT_ID> \
  --destination-cidr-block 0.0.0.0/0 \
  --nat-gateway-id <NAT_GW_ID>
```

### 2. Amazon EKS Cluster Setup

#### Create EKS Cluster
```bash
# Create cluster IAM role
aws iam create-role \
  --role-name GlobalPayEKSClusterRole \
  --assume-role-policy-document file://eks-cluster-role-trust-policy.json

aws iam attach-role-policy \
  --role-name GlobalPayEKSClusterRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEKSClusterPolicy

# Create EKS cluster
aws eks create-cluster \
  --name globalpay-prod-cluster \
  --role-arn arn:aws:iam::<ACCOUNT_ID>:role/GlobalPayEKSClusterRole \
  --resources-vpc-config subnetIds=<PRIVATE_SUBNET_IDS>,securityGroupIds=<SECURITY_GROUP_ID> \
  --kubernetes-version 1.27 \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'

# Wait for cluster to be active
aws eks wait cluster-active --name globalpay-prod-cluster

# Update kubeconfig
aws eks update-kubeconfig --name globalpay-prod-cluster --region us-east-1
```

#### Create Node Groups
```bash
# Create node group IAM role
aws iam create-role \
  --role-name GlobalPayEKSNodeRole \
  --assume-role-policy-document file://eks-node-role-trust-policy.json

# Attach required policies
aws iam attach-role-policy \
  --role-name GlobalPayEKSNodeRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy

aws iam attach-role-policy \
  --role-name GlobalPayEKSNodeRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy

aws iam attach-role-policy \
  --role-name GlobalPayEKSNodeRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly

# Create node group
aws eks create-nodegroup \
  --cluster-name globalpay-prod-cluster \
  --nodegroup-name payment-processing-nodes \
  --scaling-config minSize=3,maxSize=10,desiredSize=5 \
  --instance-types t3.xlarge \
  --subnets <PRIVATE_SUBNET_IDS> \
  --node-role arn:aws:iam::<ACCOUNT_ID>:role/GlobalPayEKSNodeRole \
  --labels environment=production,workload=payment-processing
```

#### Install Essential EKS Add-ons
```bash
# Install AWS Load Balancer Controller
helm repo add eks https://aws.github.io/eks-charts
helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=globalpay-prod-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller

# Install EBS CSI Driver
kubectl apply -k "github.com/kubernetes-sigs/aws-ebs-csi-driver/deploy/kubernetes/overlays/stable/?ref=release-1.20"

# Install Cluster Autoscaler
kubectl apply -f https://raw.githubusercontent.com/kubernetes/autoscaler/master/cluster-autoscaler/cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml
```

### 3. Amazon RDS (PostgreSQL) Setup

#### Create DB Subnet Group
```bash
aws rds create-db-subnet-group \
  --db-subnet-group-name globalpay-db-subnet-group \
  --db-subnet-group-description "Subnet group for GlobalPay databases" \
  --subnet-ids <DB_SUBNET_1A_ID> <DB_SUBNET_1B_ID>
```

#### Create Parameter Group
```bash
aws rds create-db-parameter-group \
  --db-parameter-group-name globalpay-postgres15 \
  --db-parameter-group-family postgres15 \
  --description "Custom parameter group for GlobalPay"

# Modify parameters for optimal performance
aws rds modify-db-parameter-group \
  --db-parameter-group-name globalpay-postgres15 \
  --parameters "ParameterName=max_connections,ParameterValue=1000,ApplyMethod=immediate" \
               "ParameterName=shared_buffers,ParameterValue=16777216,ApplyMethod=pending-reboot" \
               "ParameterName=work_mem,ParameterValue=65536,ApplyMethod=immediate"
```

#### Create RDS Instance
```bash
aws rds create-db-instance \
  --db-instance-identifier globalpay-prod-primary \
  --db-instance-class db.r6g.2xlarge \
  --engine postgres \
  --engine-version 15.4 \
  --master-username admin \
  --master-user-password <SECURE_PASSWORD> \
  --allocated-storage 500 \
  --storage-type gp3 \
  --iops 12000 \
  --storage-encrypted \
  --kms-key-id <KMS_KEY_ID> \
  --db-subnet-group-name globalpay-db-subnet-group \
  --vpc-security-group-ids <DB_SECURITY_GROUP_ID> \
  --backup-retention-period 35 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "mon:04:00-mon:05:00" \
  --multi-az \
  --db-parameter-group-name globalpay-postgres15 \
  --enable-cloudwatch-logs-exports '["postgresql","upgrade"]' \
  --deletion-protection \
  --copy-tags-to-snapshot
```

#### Create Read Replicas
```bash
# Create read replica in same region
aws rds create-db-instance-read-replica \
  --db-instance-identifier globalpay-prod-replica-1 \
  --source-db-instance-identifier globalpay-prod-primary \
  --db-instance-class db.r6g.xlarge \
  --availability-zone us-east-1b

# Create cross-region read replica
aws rds create-db-instance-read-replica \
  --db-instance-identifier globalpay-prod-replica-eu \
  --source-db-instance-identifier arn:aws:rds:us-east-1:<ACCOUNT_ID>:db:globalpay-prod-primary \
  --db-instance-class db.r6g.xlarge \
  --region eu-west-1
```

### 4. Amazon ElastiCache (Redis) Setup

#### Create Cache Subnet Group
```bash
aws elasticache create-cache-subnet-group \
  --cache-subnet-group-name globalpay-cache-subnet-group \
  --cache-subnet-group-description "Subnet group for GlobalPay Redis" \
  --subnet-ids <PRIVATE_SUBNET_IDS>
```

#### Create Redis Replication Group
```bash
aws elasticache create-replication-group \
  --replication-group-id globalpay-prod-redis \
  --replication-group-description "GlobalPay production Redis cluster" \
  --engine redis \
  --cache-node-type cache.r6g.xlarge \
  --num-cache-clusters 3 \
  --automatic-failover-enabled \
  --multi-az-enabled \
  --cache-subnet-group-name globalpay-cache-subnet-group \
  --security-group-ids <CACHE_SECURITY_GROUP_ID> \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled \
  --auth-token <SECURE_TOKEN> \
  --snapshot-retention-limit 7 \
  --snapshot-window "03:00-05:00" \
  --preferred-maintenance-window "mon:05:00-mon:07:00"
```

### 5. Amazon MSK (Managed Kafka) Setup

#### Create MSK Cluster
```bash
aws kafka create-cluster \
  --cluster-name globalpay-prod-kafka \
  --broker-node-group-info file://broker-node-group-info.json \
  --kafka-version 3.5.1 \
  --number-of-broker-nodes 6 \
  --encryption-info "EncryptionAtRest={DataVolumeKMSKeyId=<KMS_KEY_ID>},EncryptionInTransit={ClientBroker=TLS,InCluster=true}" \
  --enhanced-monitoring PER_TOPIC_PER_PARTITION \
  --client-authentication "Sasl={Scram={Enabled=true}},Tls={Enabled=true}" \
  --logging-info file://logging-info.json
```

broker-node-group-info.json:
```json
{
  "InstanceType": "kafka.m5.2xlarge",
  "ClientSubnets": [
    "<PRIVATE_SUBNET_1A_ID>",
    "<PRIVATE_SUBNET_1B_ID>",
    "<PRIVATE_SUBNET_1C_ID>"
  ],
  "SecurityGroups": ["<KAFKA_SECURITY_GROUP_ID>"],
  "StorageInfo": {
    "EbsStorageInfo": {
      "VolumeSize": 1000,
      "ProvisionedThroughput": {
        "Enabled": true,
        "VolumeThroughput": 250
      }
    }
  }
}
```

### 6. AWS Secrets Manager Setup

```bash
# Database credentials
aws secretsmanager create-secret \
  --name globalpay/prod/database/credentials \
  --description "PostgreSQL database credentials" \
  --secret-string '{"username":"admin","password":"<SECURE_PASSWORD>","host":"globalpay-prod-primary.xxxxx.us-east-1.rds.amazonaws.com","port":5432,"database":"globalpay"}'

# Redis credentials
aws secretsmanager create-secret \
  --name globalpay/prod/redis/auth-token \
  --description "Redis authentication token" \
  --secret-string '{"auth_token":"<SECURE_TOKEN>"}'

# JWT signing keys
aws secretsmanager create-secret \
  --name globalpay/prod/jwt/keys \
  --description "JWT signing keys" \
  --secret-string '{"private_key":"<PRIVATE_KEY>","public_key":"<PUBLIC_KEY>"}'

# Third-party API keys
aws secretsmanager create-secret \
  --name globalpay/prod/api/keys \
  --description "Third-party API keys" \
  --secret-string '{"stripe_key":"<STRIPE_KEY>","plaid_key":"<PLAID_KEY>"}'
```

### 7. AWS KMS Setup

```bash
# Create KMS key for data encryption
aws kms create-key \
  --description "GlobalPay production data encryption key" \
  --key-policy file://kms-key-policy.json

# Create alias
aws kms create-alias \
  --alias-name alias/globalpay-prod-data \
  --target-key-id <KEY_ID>

# Create separate key for secrets
aws kms create-key \
  --description "GlobalPay production secrets encryption key" \
  --key-policy file://kms-key-policy.json

aws kms create-alias \
  --alias-name alias/globalpay-prod-secrets \
  --target-key-id <KEY_ID>
```

---

## Infrastructure Setup

### Infrastructure as Code (AWS CDK Example)

Create a CDK stack for the entire infrastructure:

```typescript
// lib/globalpay-infrastructure-stack.ts
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class GlobalPayInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'GlobalPayVPC', {
      maxAzs: 3,
      natGateways: 3,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // KMS Keys
    const dataKey = new kms.Key(this, 'DataEncryptionKey', {
      description: 'GlobalPay data encryption key',
      enableKeyRotation: true,
    });

    // EKS Cluster
    const cluster = new eks.Cluster(this, 'GlobalPayCluster', {
      version: eks.KubernetesVersion.V1_27,
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      defaultCapacity: 0,
    });

    cluster.addNodegroupCapacity('PaymentProcessingNodes', {
      instanceTypes: [new ec2.InstanceType('t3.xlarge')],
      minSize: 3,
      maxSize: 10,
      desiredSize: 5,
    });

    // RDS PostgreSQL
    const database = new rds.DatabaseCluster(this, 'GlobalPayDatabase', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_4,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('admin'),
      instanceProps: {
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.R6G,
          ec2.InstanceSize.XLARGE2
        ),
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
        vpc,
      },
      instances: 2,
      storageEncrypted: true,
      storageEncryptionKey: dataKey,
    });

    // ElastiCache Redis
    const cacheSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      'CacheSubnetGroup',
      {
        description: 'GlobalPay Redis subnet group',
        subnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
      }
    );

    const redisCluster = new elasticache.CfnReplicationGroup(
      this,
      'GlobalPayRedis',
      {
        replicationGroupDescription: 'GlobalPay Redis cluster',
        engine: 'redis',
        cacheNodeType: 'cache.r6g.xlarge',
        numCacheClusters: 3,
        automaticFailoverEnabled: true,
        multiAzEnabled: true,
        cacheSubnetGroupName: cacheSubnetGroup.ref,
        atRestEncryptionEnabled: true,
        transitEncryptionEnabled: true,
      }
    );

    // Outputs
    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.clusterEndpoint.hostname,
    });
  }
}
```

Deploy the stack:
```bash
npm install -g aws-cdk
cdk init app --language typescript
cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
cdk deploy GlobalPayInfrastructureStack
```

---

## Application Deployment

### 1. Build and Push Docker Images

#### Create ECR Repositories
```bash
aws ecr create-repository \
  --repository-name globalpay/api-gateway \
  --encryption-configuration encryptionType=KMS,kmsKey=<KMS_KEY_ID>

aws ecr create-repository \
  --repository-name globalpay/payment-processor \
  --encryption-configuration encryptionType=KMS,kmsKey=<KMS_KEY_ID>

aws ecr create-repository \
  --repository-name globalpay/reconciliation-engine \
  --encryption-configuration encryptionType=KMS,kmsKey=<KMS_KEY_ID>
```

#### Build and Push Images
```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build image
docker build -t globalpay/api-gateway:latest .

# Tag image
docker tag globalpay/api-gateway:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/globalpay/api-gateway:latest

# Push image
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/globalpay/api-gateway:latest
```

### 2. Kubernetes Deployment Manifests

#### Namespace
```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: globalpay
  labels:
    name: globalpay
    environment: production
```

#### ConfigMap
```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: globalpay-config
  namespace: globalpay
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  API_PORT: "3000"
  REDIS_CLUSTER_MODE: "true"
  KAFKA_CLIENT_ID: "globalpay-api"
```

#### Secrets (from AWS Secrets Manager)
```yaml
# k8s/external-secrets.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: aws-secretsmanager
  namespace: globalpay
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: globalpay-sa

---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: database-credentials
  namespace: globalpay
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: SecretStore
  target:
    name: database-credentials
    creationPolicy: Owner
  data:
  - secretKey: username
    remoteRef:
      key: globalpay/prod/database/credentials
      property: username
  - secretKey: password
    remoteRef:
      key: globalpay/prod/database/credentials
      property: password
  - secretKey: host
    remoteRef:
      key: globalpay/prod/database/credentials
      property: host
```

#### Deployment
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
  namespace: globalpay
  labels:
    app: api-gateway
    version: v1
spec:
  replicas: 5
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
        version: v1
    spec:
      serviceAccountName: globalpay-sa
      containers:
      - name: api-gateway
        image: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/globalpay/api-gateway:latest
        ports:
        - containerPort: 3000
          name: http
          protocol: TCP
        envFrom:
        - configMapRef:
            name: globalpay-config
        env:
        - name: DATABASE_USERNAME
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: username
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: database-credentials
              key: password
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
        securityContext:
          runAsNonRoot: true
          runAsUser: 1000
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
```

#### Service
```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
  namespace: globalpay
  labels:
    app: api-gateway
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
    name: http
  selector:
    app: api-gateway
```

#### Ingress (ALB)
```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-gateway-ingress
  namespace: globalpay
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: <ACM_CERTIFICATE_ARN>
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
    alb.ingress.kubernetes.io/healthcheck-path: /health
    alb.ingress.kubernetes.io/wafv2-acl-arn: <WAF_ACL_ARN>
spec:
  rules:
  - host: api.globalpay.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-gateway
            port:
              number: 80
```

#### Horizontal Pod Autoscaler
```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
  namespace: globalpay
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 5
  maxReplicas: 50
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15
      - type: Pods
        value: 4
        periodSeconds: 15
      selectPolicy: Max
```

### 3. Deploy to EKS

```bash
# Apply all manifests
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/external-secrets.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Verify deployment
kubectl get pods -n globalpay
kubectl get svc -n globalpay
kubectl get ingress -n globalpay

# Check pod logs
kubectl logs -f deployment/api-gateway -n globalpay
```

---

## Security Configuration

### 1. Security Groups

#### EKS Cluster Security Group
```bash
aws ec2 create-security-group \
  --group-name globalpay-eks-cluster-sg \
  --description "Security group for EKS cluster" \
  --vpc-id <VPC_ID>

# Allow HTTPS from worker nodes
aws ec2 authorize-security-group-ingress \
  --group-id <CLUSTER_SG_ID> \
  --protocol tcp \
  --port 443 \
  --source-group <WORKER_SG_ID>
```

#### RDS Security Group
```bash
aws ec2 create-security-group \
  --group-name globalpay-rds-sg \
  --description "Security group for RDS PostgreSQL" \
  --vpc-id <VPC_ID>

# Allow PostgreSQL from EKS worker nodes
aws ec2 authorize-security-group-ingress \
  --group-id <RDS_SG_ID> \
  --protocol tcp \
  --port 5432 \
  --source-group <WORKER_SG_ID>
```

#### Redis Security Group
```bash
aws ec2 create-security-group \
  --group-name globalpay-redis-sg \
  --description "Security group for Redis" \
  --vpc-id <VPC_ID>

# Allow Redis from EKS worker nodes
aws ec2 authorize-security-group-ingress \
  --group-id <REDIS_SG_ID> \
  --protocol tcp \
  --port 6379 \
  --source-group <WORKER_SG_ID>
```

### 2. IAM Roles and Policies

#### EKS Pod IAM Role (IRSA)
```bash
# Create OIDC provider for EKS
eksctl utils associate-iam-oidc-provider \
  --cluster globalpay-prod-cluster \
  --approve

# Create service account with IAM role
eksctl create iamserviceaccount \
  --name globalpay-sa \
  --namespace globalpay \
  --cluster globalpay-prod-cluster \
  --attach-policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite \
  --attach-policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess \
  --approve \
  --override-existing-serviceaccounts
```

### 3. AWS WAF Configuration

```bash
# Create WAF Web ACL
aws wafv2 create-web-acl \
  --name globalpay-prod-waf \
  --scope REGIONAL \
  --default-action Allow={} \
  --rules file://waf-rules.json \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=GlobalPayWAF
```

waf-rules.json:
```json
[
  {
    "Name": "RateLimitRule",
    "Priority": 1,
    "Statement": {
      "RateBasedStatement": {
        "Limit": 2000,
        "AggregateKeyType": "IP"
      }
    },
    "Action": {
      "Block": {}
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "RateLimitRule"
    }
  },
  {
    "Name": "AWSManagedRulesCommonRuleSet",
    "Priority": 2,
    "OverrideAction": {
      "None": {}
    },
    "Statement": {
      "ManagedRuleGroupStatement": {
        "VendorName": "AWS",
        "Name": "AWSManagedRulesCommonRuleSet"
      }
    },
    "VisibilityConfig": {
      "SampledRequestsEnabled": true,
      "CloudWatchMetricsEnabled": true,
      "MetricName": "AWSManagedRulesCommonRuleSet"
    }
  }
]
```

### 4. AWS Shield Advanced

```bash
# Subscribe to Shield Advanced (via console or CLI)
aws shield subscribe \
  --subscription {}

# Protect ALB
aws shield create-protection \
  --name globalpay-alb-protection \
  --resource-arn <ALB_ARN>
```

---

## Monitoring and Logging

### 1. CloudWatch Container Insights

```bash
# Install CloudWatch agent
kubectl apply -f https://raw.githubusercontent.com/aws-samples/amazon-cloudwatch-container-insights/latest/k8s-deployment-manifest-templates/deployment-mode/daemonset/container-insights-monitoring/quickstart/cwagent-fluentd-quickstart.yaml
```

### 2. CloudWatch Dashboards

Create custom dashboard:
```bash
aws cloudwatch put-dashboard \
  --dashboard-name GlobalPay-Production \
  --dashboard-body file://cloudwatch-dashboard.json
```

### 3. CloudWatch Alarms

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name globalpay-high-cpu \
  --alarm-description "Alert when CPU exceeds 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/EKS \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions <SNS_TOPIC_ARN>

# Database connection errors
aws cloudwatch put-metric-alarm \
  --alarm-name globalpay-db-connection-errors \
  --alarm-description "Alert on database connection errors" \
  --metric-name DatabaseConnections \
  --namespace AWS/RDS \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 2 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions <SNS_TOPIC_ARN>

# API 5xx errors
aws cloudwatch put-metric-alarm \
  --alarm-name globalpay-api-5xx-errors \
  --alarm-description "Alert on 5xx errors" \
  --metric-name HTTPCode_Target_5XX_Count \
  --namespace AWS/ApplicationELB \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions <SNS_TOPIC_ARN>
```

### 4. X-Ray Integration

```bash
# Deploy X-Ray daemon to EKS
kubectl apply -f https://eksworkshop.com/intermediate/245_x-ray/daemonset.files/xray-k8s-daemonset.yaml
```

---

## Disaster Recovery

### 1. Automated Backups

#### RDS Snapshots
Already configured via RDS settings (35-day retention)

#### EBS Snapshots (for EKS persistent volumes)
```bash
# Create Data Lifecycle Manager policy
aws dlm create-lifecycle-policy \
  --execution-role-arn arn:aws:iam::<ACCOUNT_ID>:role/AWSDataLifecycleManagerDefaultRole \
  --description "Daily EBS snapshots for EKS volumes" \
  --state ENABLED \
  --policy-details file://dlm-policy.json
```

### 2. Cross-Region Replication

#### S3 Cross-Region Replication
```bash
# Enable versioning on source bucket
aws s3api put-bucket-versioning \
  --bucket globalpay-prod-data-us-east-1 \
  --versioning-configuration Status=Enabled

# Create replication rule
aws s3api put-bucket-replication \
  --bucket globalpay-prod-data-us-east-1 \
  --replication-configuration file://replication-config.json
```

### 3. Disaster Recovery Runbook

**RTO (Recovery Time Objective)**: 4 hours
**RPO (Recovery Point Objective)**: 1 minute

#### Failover Procedure:
1. Update Route 53 health checks to mark primary region as unhealthy
2. Promote read replica to primary in secondary region
3. Update application configuration to point to new database
4. Scale up EKS cluster in secondary region
5. Update DNS records to point to secondary region ALB

```bash
# Promote read replica
aws rds promote-read-replica \
  --db-instance-identifier globalpay-prod-replica-eu \
  --region eu-west-1

# Update Route 53
aws route53 change-resource-record-sets \
  --hosted-zone-id <HOSTED_ZONE_ID> \
  --change-batch file://failover-dns-change.json
```

---

## Cost Optimization

### 1. Reserved Instances and Savings Plans

```bash
# Purchase Compute Savings Plan (recommended)
aws savingsplans purchase-savings-plan \
  --savings-plan-type ComputeSavingsPlans \
  --commitment 10000 \
  --term-years 1 \
  --payment-option AllUpfront
```

### 2. Right-Sizing Recommendations

Monitor using AWS Cost Explorer and Compute Optimizer:
```bash
aws compute-optimizer get-ec2-instance-recommendations \
  --instance-arns <INSTANCE_ARN>
```

### 3. S3 Lifecycle Policies

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket globalpay-prod-data \
  --lifecycle-configuration file://lifecycle-policy.json
```

### 4. Cost Allocation Tags

```bash
# Tag all resources
aws resourcegroupstaggingapi tag-resources \
  --resource-arn-list <RESOURCE_ARNS> \
  --tags Environment=Production,Project=GlobalPay,CostCenter=Engineering
```

### Estimated Monthly Costs (Production):
- **EKS**: $220 (cluster) + $800 (EC2 instances) = $1,020
- **RDS**: $1,200 (primary) + $600 (replicas) = $1,800
- **ElastiCache**: $600
- **MSK**: $1,500
- **Data Transfer**: $500
- **S3**: $200
- **CloudWatch/X-Ray**: $300
- **Total**: ~$5,920/month (before Savings Plans)

---

## Troubleshooting

### Common Issues

#### 1. Pods Not Starting
```bash
# Check pod status
kubectl describe pod <POD_NAME> -n globalpay

# Check events
kubectl get events -n globalpay --sort-by='.lastTimestamp'

# Check logs
kubectl logs <POD_NAME> -n globalpay
```

#### 2. Database Connection Issues
```bash
# Test connectivity from pod
kubectl run -it --rm debug --image=postgres:15 --restart=Never -- psql -h <DB_ENDPOINT> -U admin -d globalpay

# Check security groups
aws ec2 describe-security-groups --group-ids <SG_ID>
```

#### 3. High Latency
```bash
# Check X-Ray traces
aws xray get-trace-summaries \
  --start-time <START_TIME> \
  --end-time <END_TIME>

# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/EKS \
  --metric-name APIServerRequestLatency \
  --start-time <START_TIME> \
  --end-time <END_TIME> \
  --period 300 \
  --statistics Average
```

#### 4. Certificate Issues
```bash
# Verify ACM certificate
aws acm describe-certificate --certificate-arn <CERT_ARN>

# Check certificate expiration
aws acm list-certificates --certificate-statuses ISSUED
```

### Support Contacts

- **AWS Support**: Premium support plan required for production workloads
- **Internal Escalation**: On-call rotation via PagerDuty
- **Vendor Support**: Maintain support contracts with Stripe, Plaid, etc.

---

## Additional Resources

- [AWS EKS Best Practices Guide](https://aws.github.io/aws-eks-best-practices/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [PCI DSS on AWS](https://aws.amazon.com/compliance/pci-dss-level-1-faqs/)
- [AWS Security Best Practices](https://docs.aws.amazon.com/security/)

---

## Appendix

### A. Required IAM Policies

See separate IAM policy documents in `/docs/iam-policies/`

### B. Network Diagrams

See separate network architecture diagrams in `/docs/architecture/`

### C. Runbooks

See separate runbooks for incident response in `/docs/runbooks/`

### D. Compliance Checklists

See PCI DSS and SOC 2 compliance checklists in `/docs/compliance/`
