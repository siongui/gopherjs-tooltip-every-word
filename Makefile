export GOROOT=$(realpath ../go)
export GOPATH=$(realpath .)
export PATH := $(GOROOT)/bin:$(GOPATH)/bin:$(PATH)

PKG="github.com/siongui/gopherjs-tooltip-every-word"

devserver: local js
	@echo "\033[92mDevelopment Server Running ...\033[0m"
	@go run devserver/server.go

js:
	@echo "\033[92mGenerating JavaScript ...\033[0m"
	@gopherjs build example/app.go -o example/app.js

fmt:
	@echo "\033[92mGo fmt source code...\033[0m"
	@go fmt *.go
	@go fmt example/*.go

local:
	@[ -d src/${PKG}/ ] || mkdir -p src/${PKG}/
	@cp wrap.go src/${PKG}/

install:
	@echo "\033[92mInstalling GopherJS ...\033[0m"
	go get -u github.com/gopherjs/gopherjs
	go get -u github.com/siongui/gopherjs-tooltip

deploy:
	@echo "\033[92mDeploy to GitHub Pages (Project) ...\033[0m"
	@rm example/*.go
	@ghp-import example/
	@git push origin gh-pages
	@git checkout example/
