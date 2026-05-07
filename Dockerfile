FROM livekit/livekit-server:latest
WORKDIR /app
COPY livekit.yaml .
CMD ["/livekit-server", "--config", "livekit.yaml"]