# Firebase Emulator Suite — Auth + Firestore + Storage
#
# Build:  docker build -t firebase-emulator docker/firebase-emulator
# Run:    docker run -p 9099:9099 -p 8080:8080 -p 19199:19199 -p 4000:4000 firebase-emulator
#
# The emulator accepts any non-empty Firebase config values.
# Security rules and indexes are baked into the image from the repo root.

FROM node:24-slim

# Java 21+ is required by the Firestore emulator (firebase-tools >=15.x).
# Debian Bookworm only ships JDK 17, so take the JRE from the official image
# (Docker Hub, like the base) instead of Adoptium's apt server, which can be down.
# jammy (glibc 2.35) is not newer than node:24-slim's bookworm (glibc 2.36).
COPY --from=eclipse-temurin:21.0.13_9-jre-jammy /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# curl is used by the health check
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install firebase-tools globally (pinned version for reproducibility)
RUN npm install -g firebase-tools@15.8.0

# Pre-download emulator binaries so startup is instant
RUN firebase setup:emulators:firestore && \
    firebase setup:emulators:ui

WORKDIR /app

# Copy only what the emulators need
# Use the Docker-specific firebase.json that binds to 0.0.0.0
COPY docker/firebase-emulator/firebase.json .
COPY firestore.rules .
COPY firestore.indexes.json .
COPY storage.rules .

# Ports: Auth (9099), Firestore (8080), Storage (19199: the defaults belong to another project's emulator), Emulator UI (4000)
EXPOSE 9099 8080 19199 4000

# Health check — Firestore emulator serves on 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=10 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start emulators — project ID must start with "demo-" for offline mode
CMD ["firebase", "emulators:start", \
     "--only", "auth,firestore,storage", \
     "--project", "demo-alter-ego"]
