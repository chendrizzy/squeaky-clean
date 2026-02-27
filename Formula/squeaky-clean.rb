class SqueakyClean < Formula
  desc "Smart, safe, configurable cache cleaner CLI for 25+ dev tools"
  homepage "https://github.com/chendrizzy/squeaky-clean"
  url "https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-0.4.3.tgz"
  sha256 "c8d3eae160a892e32837db3dcae515e843e5383fef52b8141940c8bcf8b6d59f"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/squeaky --version")
    assert_match version.to_s, output
  end
end
