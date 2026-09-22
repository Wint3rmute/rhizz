component "computer" {
  full_name = "PC computer"
  instance "cpu" { source = "cpu" }
  instance "gpu" { source = "gpu" }

  connection "pci" {
    full_name = "PCI bus"
    from        = "cpu"
    to          = "gpu"
  }
}

component "gpu" {
  full_name = "Graphics Card"
  leaf        = true
}

component "cpu" {
  full_name = "Central Processing Unit"
  leaf        = true
}

component "monitor" {
  full_name = "FullHD Monitor"
  leaf        = true
}

system "computer-setup" {
  full_name = "Computer Setup"

  instance "computer" { source = "computer" }
  instance "monitor" { source = "monitor" }

  connection "hdmi" {
    full_name = "HDMI connection"
    from        = "computer"
    to          = "monitor"
  }
}
