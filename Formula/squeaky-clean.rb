class SqueakyClean < Formula
  desc "Smart, safe, configurable cache cleaner CLI for 25+ dev tools"
  homepage "https://github.com/chendrizzy/squeaky-clean"
  url "https://registry.npmjs.org/squeaky-clean/-/squeaky-clean-0.4.12.tgz"
  sha256 "b17b87be12bcad943171699879312545ba9f13f356147c8555a62bcb267690ea"
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
