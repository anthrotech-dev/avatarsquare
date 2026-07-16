# go.modのgoディレクティブ(依存更新で上がる)以上のバージョンにすること
FROM golang:1.26 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /token-server .

FROM gcr.io/distroless/static-debian12
COPY --from=build /token-server /token-server
EXPOSE 8787
ENTRYPOINT ["/token-server"]
