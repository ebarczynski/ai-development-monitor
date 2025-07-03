#!/bin/bash

# Script to install dependencies for Hugging Face API integration
echo "Installing required dependencies for Hugging Face API integration..."

# Make sure we're in the extension directory
cd "$(dirname "$0")"

# Install axios for HTTP requests
npm install axios --save

echo "Dependencies installed successfully!"
echo "Version updated to 0.7.0 with Hugging Face API integration."
