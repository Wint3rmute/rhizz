component "computer" {
  full_name = "PC computer"
  instance "cpu" { source = "cpu" }
  instance "gpu" { source = "gpu" }

  port "hdmi" {
    role = "provider"
  }

  connection "pci" {
    full_name = "PCI bus"
    from        = "cpu/pci"
    to          = "gpu/pci"
  }
}

component "gpu" {
  full_name = "Graphics Card"
  leaf        = true

  port "pci" {
    role = "consumer"
  }
}

component "cpu" {
  full_name = "Central Processing Unit"
  leaf        = true

  port "pci" {
    role = "provider"
  }
}

component "monitor" {
  full_name = "FullHD Monitor"
  leaf        = true

  port "hdmi" {
    role = "consumer"
  }
}

system "computer-setup" {
  full_name = "Computer Setup"

  instance "computer" { source = "computer" }
  instance "monitor" { source = "monitor" }

  connection "hdmi" {
    full_name = "HDMI connection"
    from        = "computer/hdmi"
    to          = "monitor/hdmi"
  }
}
