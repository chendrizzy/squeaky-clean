class SqueakyClean < Formula
  desc "Smart, safe, configurable cache cleaner CLI for 25+ dev tools"
  homepage "https://github.com/chendrizzy/squeaky-clean"
  url "https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-0.4.8.tgz"
  sha256 "4ae4cdab79230a41c3ca450ab2b7b1638a17b044b7357924637566404c195c1b"
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
