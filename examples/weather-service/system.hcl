project {
  name        = "weather-service"
  full_name   = "Weather Service"
  description = "Encapsulated backend with proxy ports and delegation"
  version     = "0.1.0"
  authors     = ["rhizome-examples"]
}

protocol "rest" {
  full_name = "REST over HTTP"
  roles       = ["provider", "consumer"]
  leaf        = true

  message "forecast-request" {
    full_name = "Weather forecast request"

    field "location" {
      type        = "string"
      full_name = "Location query"
    }
  }

  message "forecast-response" {
    full_name = "Weather forecast response"

    field "temperature" {
      type        = "float32"
      full_name = "Temperature in Celsius"
    }
  }
}

component "listener" {
  full_name = "HTTP listener socket"
  color       = "secondary"
  tags        = ["network"]
  leaf        = true

  port "http" {
    full_name = "Raw HTTP socket"
    protocol    = "rest"
    role        = "provider"
    tags        = ["network"]
    external    = true
  }
}

component "reverse-proxy" {
  full_name = "Reverse proxy terminating TLS"
  color       = "primary"
  tags        = ["network"]

  port "http" {
    full_name = "Public HTTP entrypoint"
    external    = true
  }

  instance "listener" { source = "listener" }

  connection "http-delegation" {
    full_name  = "Boundary forwards to the listener socket"
    from         = "./http"
    to           = "listener/http"
  }
}

component "user" {
  full_name = "Mobile app client"
  tags        = ["frontend"]
  leaf        = true

  port "out" {
    full_name = "Forecast API calls"
    protocol    = "rest"
    role        = "consumer"
    tags        = ["data"]
    external    = true
  }
}

component "weather-service" {
  full_name = "Weather forecast service"
  tags        = ["backend"]

  port "api" {
    full_name = "Forecast REST API"
    external    = true
  }

  instance "proxy" { source = "reverse-proxy" }

  connection "api-delegation" {
    full_name  = "Boundary forwards to the reverse proxy"
    from         = "./api"
    to           = "proxy/http"
  }
}

system "app" {
  full_name = "Weather app with an encapsulated forecast service"
  tags        = ["backend", "frontend"]

  instance "user" { source = "user" }

  instance "weather-service" { source = "weather-service" }

  connection "forecast" {
    full_name  = "Forecast API used by the mobile client"
    tags         = ["data"]
    from         = "/app/user/out"
    to           = "/app/weather-service/api"
  }
}
