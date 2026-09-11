component "computer" {
  description = "PC computer"
  instance "cpu" { source = "cpu" }
  instance "gpu" { source = "gpu" }

  connection "pci" {
    description = "PCI bus"
    from        = "cpu"
    to          = "gpu"
  }
}

component "gpu" {
  description = "Graphics Card"
  leaf        = true
}

component "cpu" {
  description = "Central Processing Unit"
  leaf        = true
}

component "monitor" {
  description = "FullHD Monitor"
  leaf        = true
}

system "computer-setup" {
  description = "Computer Setup"

  instance "computer" { source = "computer" }
  instance "monitor" { source = "monitor" }

  connection "hdmi" {
    description = "HDMI connection"
    from        = "computer"
    to          = "monitor"
  }
}
