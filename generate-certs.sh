#!/bin/bash
# Script to generate self-signed SSL certificates for Docker Nginx
# Run this from the project root

mkdir -p nginx/certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/certs/asterflow.key \
  -out nginx/certs/asterflow.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

echo "SSL Certificates generated in nginx/certs/"
